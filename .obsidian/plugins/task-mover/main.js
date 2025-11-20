/*
 * Kinetic TaskMover – ID-based, source-aware, conservative dedupe
 * (with nested child lines)
 *
 * Design:
 *  - Kinetic-Tasks.md is the canonical ledger for all tasks.
 *  - Every task has a short ID token of the form ^t123^
 *      * Always inserted right after the checkbox: "- [ ] ^t123^ ..."
 *      * Never depends on anything at the end of the line.
 *  - TaskMover scans Daily notes + Project Files (entire vault minus a few
 *    excluded views) for open tasks:
 *      * If a task already has ^tNNN^, TaskMover makes sure there is at
 *        least one matching entry in Kinetic-Tasks.md with that ID.
 *        When it adds that entry, it now also pulls in any indented child
 *        lines underneath the task (subtasks, notes, etc.).
 *      * If a task has no ID, TaskMover ALWAYS assigns a fresh ID and
 *        writes it both to the source line and the ledger, again bringing
 *        along nested child lines.
 *  - IDs are monotonic and never reused:
 *      * The next ID counter lives in plugin settings (this.settings.nextId).
 *      * Even if you delete completed tasks from the ledger, new IDs will
 *        continue incrementing upward and will not collide with old ones.
 *  - Deduplication is intentionally conservative:
 *      * The ledger dedupe command removes exact ID duplicates (same ^tNNN^),
 *        but it does NOT merge tasks purely by matching content text.
 */

const { Plugin, Notice, TFile, normalizePath } = require('obsidian');

const DEFAULT_SETTINGS = {
  compiledTasksFile: 'Tasks/Kinetic-Tasks.md',
  nextId: 1
};

// Files that should NEVER be treated as sources for tasks
const EXCLUDED_SOURCE_PATHS = [
  'Tasks/Kinetic-Tasks.md',    // the ledger itself
  'Projects.md',               // projects view
  'People/Kinetic-People.md'   // people ledger view
];

// ID token looks like ^t123^
const ID_REGEX = /\^t(\d+)\^/;

module.exports = class KineticTaskMover extends Plugin {
  async onload() {
    const loaded = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    this.addCommand({
      id: 'kinetic-move-tasks-to-ledger',
      name: 'Kinetic: Consolidate unfinished tasks into ledger',
      callback: async () => {
        await this.moveUnfinishedTasks();
      },
    });

    this.addCommand({
      id: 'kinetic-dedupe-task-ledger',
      name: 'Kinetic: Deduplicate task ledger (by ID)',
      callback: async () => {
        await this.dedupeLedger();
      },
    });
  }

  async onunload() {
    await this.saveData(this.settings);
  }

  // ---------- Utility: grab a task "block" (header + nested children) ----------

  /**
   * Given the lines of a file and the index of a task header line,
   * return an array containing the header plus any immediately following
   * lines that are more indented than the header (subtasks / notes).
   */
  getTaskBlock(lines, startIndex) {
    const block = [];
    if (startIndex < 0 || startIndex >= lines.length) return block;

    const headerLine = lines[startIndex];
    block.push(headerLine);

    const headerIndentMatch = headerLine.match(/^\s*/);
    const headerIndent = headerIndentMatch ? headerIndentMatch[0].length : 0;

    for (let j = startIndex + 1; j < lines.length; j++) {
      const line = lines[j];

      // Always include blank lines that immediately follow; they keep spacing tidy.
      if (line.trim().length === 0) {
        block.push(line);
        continue;
      }

      const indentMatch = line.match(/^\s*/);
      const indent = indentMatch ? indentMatch[0].length : 0;

      // Any non-blank line with indentation <= headerIndent is not a child.
      if (indent <= headerIndent) {
        break;
      }

      block.push(line);
    }

    return block;
  }

  // ---------- Core: consolidate tasks into Kinetic-Tasks.md ----------

  async moveUnfinishedTasks() {
    new Notice('Kinetic: collecting tasks…');

    const vault = this.app.vault;
    const compiledPath = normalizePath(this.settings.compiledTasksFile);

    // Load current ledger state (lines + IDs present + max ID seen)
    const ledgerState = await this.loadLedgerState(compiledPath);
    let ledgerLines = ledgerState.lines.slice();
    const idSet = ledgerState.idSet;           // Set of "t123"
    const ledgerMaxId = ledgerState.maxId;     // largest numeric ID in ledger

    // Ensure our nextId counter is at least ledgerMaxId + 1
    const requiredNext = ledgerMaxId + 1;
    if (!this.settings.nextId || this.settings.nextId < requiredNext) {
      this.settings.nextId = requiredNext;
      await this.saveData(this.settings);
    }

    let addedCount = 0;

    // Scan all markdown files except excluded sources & ledger
    const files = vault.getMarkdownFiles().filter((file) => {
      const path = normalizePath(file.path);
      if (EXCLUDED_SOURCE_PATHS.includes(path)) return false;
      if (path === compiledPath) return false;
      return true;
    });

    for (const file of files) {
      const original = await vault.cachedRead(file);
      const lines = original.split('\n');
      let changed = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        // Only consider open tasks: "- [ ]"
        if (!trimmed.startsWith('- [ ]')) continue;

        // Does this task already have an ID token?
        const idMatch = line.match(ID_REGEX);
        if (idMatch) {
          const id = `t${idMatch[1]}`;

          // If ledger doesn't yet have this ID, append this task block
          // (header + nested children) as the canonical representation.
          if (!idSet.has(id)) {
            const block = this.getTaskBlock(lines, i);
            ledgerLines.push(...block);
            idSet.add(id);
            addedCount++;
          }

          // No changes needed in the source file for this line
          continue;
        }

        // No ID yet: ALWAYS assign a fresh ID for this source task
        const newId = `t${this.settings.nextId}`;
        this.settings.nextId += 1;

        const newHeaderLine = this.insertIdIntoTaskLine(line, newId);
        lines[i] = newHeaderLine;
        changed = true;

        if (!idSet.has(newId)) {
          const block = this.getTaskBlock(lines, i);
          // Ensure the first line of the block is the updated header line
          if (block.length > 0) {
            block[0] = newHeaderLine;
          } else {
            block.push(newHeaderLine);
          }
          ledgerLines.push(...block);
          idSet.add(newId);
          addedCount++;
        }
      }

      if (changed) {
        await vault.modify(file, lines.join('\n'));
      }
    }

    // Persist updated nextId
    await this.saveData(this.settings);

    // Write the updated ledger content back
    const ledgerFile = vault.getAbstractFileByPath(compiledPath);
    const newLedgerContent = ledgerLines.join('\n');

    if (ledgerFile instanceof TFile) {
      await this.app.vault.modify(ledgerFile, newLedgerContent);
    } else {
      await this.app.vault.create(compiledPath, newLedgerContent);
    }

    new Notice(`Kinetic: tasks synced. ${addedCount} new ledger entries (including nested notes).`);
  }

  // ---------- Ledger state helpers ----------

  async loadLedgerState(compiledPath) {
    const vault = this.app.vault;
    const file = vault.getAbstractFileByPath(compiledPath);

    let lines = [];
    const idSet = new Set();   // set of "t123"
    let maxId = 0;

    if (file instanceof TFile) {
      const content = await vault.read(file);
      lines = content.split('\n');

      for (const line of lines) {
        const match = line.match(ID_REGEX);
        if (match) {
          const numeric = parseInt(match[1], 10);
          const id = `t${numeric}`;
          idSet.add(id);
          if (!isNaN(numeric) && numeric > maxId) {
            maxId = numeric;
          }
        }
      }
    }

    return { lines, idSet, maxId };
  }

  /**
   * Insert an ID token ^tNNN^ into a task line right after the checkbox.
   * If the line already has any ID token(s), they are stripped so we end
   * up with exactly one ID per task.
   */
  insertIdIntoTaskLine(line, id) {
    const match = line.match(/^(\s*-\s\[\s\]\s+)(.*)$/);
    if (!match) return line;

    const prefix = match[1];  // indentation + "- [ ] "
    let rest = match[2];      // the rest of the line

    // Remove any existing ID token(s) in the rest of the line
    rest = rest.replace(ID_REGEX, '').trimStart();

    // Build new line: "- [ ] ^t123^ rest..."
    const newLine = `${prefix}^${id}^ ${rest}`;
    return newLine;
  }

  // ---------- Ledger deduplication ----------

  /**
   * Deduplicate the ledger file in-place:
   *  - If multiple task *blocks* share the same ^tNNN^, keep the first
   *    header + its nested children and drop the later ones.
   *  - For task lines that have no ID, we keep them as-is (no content-based merge).
   *  - We also normalize any tasks that have more than one ID by re-writing them
   *    to keep only the first ^tNNN^ match.
   */
  async dedupeLedger() {
    const vault = this.app.vault;
    const compiledPath = normalizePath(this.settings.compiledTasksFile);
    const file = vault.getAbstractFileByPath(compiledPath);

    if (!(file instanceof TFile)) {
      new Notice('Kinetic: ledger file not found.');
      return;
    }

    const content = await vault.read(file);
    const lines = content.split('\n');

    const seenIds = new Set();
    const out = [];

    const isTaskHeader = (line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]');
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (!isTaskHeader(line)) {
        // Non-task lines are always preserved
        out.push(line);
        i += 1;
        continue;
      }

      // We're at a task header; grab its block
      const block = this.getTaskBlock(lines, i);
      const header = block[0] ?? line;

      // Normalize ID usage on the header (strip extra IDs if any)
      const allMatches = [...header.matchAll(ID_REGEX)];
      let normalizedHeader = header;

      if (allMatches.length > 1) {
        const firstId = `t${allMatches[0][1]}`;
        normalizedHeader = this.insertIdIntoTaskLine(header, firstId);
      }

      const idMatch = normalizedHeader.match(ID_REGEX);

      if (idMatch) {
        const id = `t${idMatch[1]}`;

        if (seenIds.has(id)) {
          // Duplicate ID → drop this entire block
          i += block.length;
          continue;
        }

        seenIds.add(id);
        // Use normalized header + original children
        const normalizedBlock = block.slice();
        normalizedBlock[0] = normalizedHeader;
        out.push(...normalizedBlock);
      } else {
        // Task block with no ID → keep it as-is
        out.push(...block);
      }

      i += block.length;
    }

    await vault.modify(file, out.join('\n'));
    new Notice('✅ Kinetic: ledger deduplicated by ID (blocks preserved).');
  }
};
