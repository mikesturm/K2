// Kinetic Projects Ledger – builds Existing Projects from Tasks/Kinetic-Tasks.md
// and the Project Index table in Projects.md, including subtasks (indented lines).
// Also adds stable ^id anchors to task blocks in BOTH the tasks ledger and Projects view,
// and can sync completed tasks (checked in Projects.md) back to the tasks ledger.

const { Plugin, Notice, TFile } = require('obsidian');

// Paths – adjust if needed
const TASKS_LEDGER_PATH = 'Tasks/Kinetic-Tasks.md';
const PROJECTS_FILE_PATH = 'Projects.md';

// Optional status filter:
// - null  -> show ALL projects that have tasks
// - 'In progress.' -> only show rows whose Status cell matches (case-insensitive, ignores trailing '.')
const STATUS_FILTER = 'In progress.'; // set to null if you want all projects

class KineticProjectsLedgerPlugin extends Plugin {
  async onload() {
    console.log('KineticProjectsLedger: loaded');

    this.addCommand({
      id: 'kinetic-build-projects-from-ledger',
      name: 'Kinetic: Rebuild Existing Projects section',
      callback: () => this.buildProjectsView()
    });

    this.addCommand({
      id: 'kinetic-sync-project-completions',
      name: 'Kinetic: Sync project completions back to tasks ledger',
      callback: () => this.syncCompletionsBackToLedger()
    });
  }

  // -----------------------------
  // Main: rebuild Existing Projects
  // -----------------------------
  async buildProjectsView() {
    const vault = this.app.vault;
    new Notice('Kinetic: rebuilding Existing Projects from tasks…');

    // --- Read Projects.md ---
    const projectsFile = vault.getAbstractFileByPath(PROJECTS_FILE_PATH);
    if (!(projectsFile instanceof TFile)) {
      new Notice(`❌ Projects file not found at: ${PROJECTS_FILE_PATH}`);
      return;
    }
    const projRaw = await vault.read(projectsFile);
    const projLines = projRaw.split('\n');

    // --- Parse Project Index table to map P# → { name, status } ---
    const projectMap = this.parseProjectIndex(projLines);

    // --- Read Tasks/Kinetic-Tasks.md and detect task blocks + add IDs in ledger ---
    const tasksFile = vault.getAbstractFileByPath(TASKS_LEDGER_PATH);
    if (!(tasksFile instanceof TFile)) {
      new Notice(`❌ Tasks ledger not found at: ${TASKS_LEDGER_PATH}`);
      return;
    }
    let tasksRaw = await vault.read(tasksFile);
    let { tasksByProject, updatedTasksRaw } =
      this.extractBlocksAndEnsureIds(tasksRaw);

    // If we wrote any new ^ids, update the ledger file
    if (updatedTasksRaw !== tasksRaw) {
      await vault.modify(tasksFile, updatedTasksRaw);
      tasksRaw = updatedTasksRaw;
    }

    // --- Build new Existing Projects section ---
    const newExistingProjectsSection =
      this.buildExistingProjectsSection(projectMap, tasksByProject);

    // --- Splice into Projects.md, preserving everything above ---
    const newProjectsContent =
      this.mergeIntoProjectsFile(projLines, newExistingProjectsSection);

    await vault.modify(projectsFile, newProjectsContent);
    new Notice('✅ Kinetic: Existing Projects section rebuilt.');
  }

  // -----------------------------
  // Main: sync completions back
  // -----------------------------
  async syncCompletionsBackToLedger() {
    const vault = this.app.vault;
    new Notice('Kinetic: syncing project completions back to tasks…');

    // Read Projects.md
    const projectsFile = vault.getAbstractFileByPath(PROJECTS_FILE_PATH);
    if (!(projectsFile instanceof TFile)) {
      new Notice(`❌ Projects file not found at: ${PROJECTS_FILE_PATH}`);
      return;
    }
    const projRaw = await vault.read(projectsFile);
    const projLines = projRaw.split('\n');

    // Collect completed ^ids from # Existing Projects section
    const completedIds = this.collectCompletedIdsFromProjects(projLines);

    if (completedIds.size === 0) {
      new Notice('Kinetic: no completed tasks with ^ids found in Projects.md.');
      return;
    }

    // Read tasks ledger
    const tasksFile = vault.getAbstractFileByPath(TASKS_LEDGER_PATH);
    if (!(tasksFile instanceof TFile)) {
      new Notice(`❌ Tasks ledger not found at: ${TASKS_LEDGER_PATH}`);
      return;
    }
    const tasksRaw = await vault.read(tasksFile);
    const tasksLines = tasksRaw.split('\n');

    // Flip matching tasks from - [ ] to - [x] based on ^id
    let changed = false;
    const taskLineWithIdRe = /^(\s*)-\s\[\s\]\s+(.*\^[A-Za-z0-9_-]+\s*)$/;

    for (let i = 0; i < tasksLines.length; i++) {
      const line = tasksLines[i];
      const idMatch = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
      if (!idMatch) continue;

      const id = idMatch[1];
      if (!completedIds.has(id)) continue;

      const m = line.match(taskLineWithIdRe);
      if (!m) continue; // not an open task, or no checkbox match

      const indent = m[1];
      const rest = m[2];
      tasksLines[i] = `${indent}- [x] ${rest}`;
      changed = true;
    }

    if (changed) {
      const updated = tasksLines.join('\n');
      await vault.modify(tasksFile, updated);
      new Notice('✅ Kinetic: synced project completions to tasks ledger.');
    } else {
      new Notice('Kinetic: no matching open tasks in ledger for completed ^ids.');
    }
  }

  // -----------------------------
  // Parse Project Index table
  // -----------------------------
  parseProjectIndex(lines) {
    const map = {}; // P# -> { name, status }

    // Find header row that starts with "| ID"
    const headerIdx = lines.findIndex((l) => l.match(/^\| *ID\b/i));
    if (headerIdx === -1) {
      console.warn('KineticProjectsLedger: No Project Index table header found.');
      return map;
    }

    let i = headerIdx + 1;
    // Skip the separator row like | --- | --- | ...
    if (i < lines.length && lines[i].trim().startsWith('|')) {
      i++;
    }

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim().startsWith('|')) break; // end of table

      const cells = line.split('|').map((c) => c.trim());
      // cells[1] = ID, cells[2] = Project Name, cells[3] = Status
      const idCell = cells[1] || '';
      const nameCell = cells[2] || '';
      const statusCell = cells[3] || '';

      const idMatch = idCell.match(/^P\d+$/i);
      if (idMatch) {
        const id = idMatch[0].toUpperCase(); // P1, P2, ...
        map[id] = {
          name: nameCell || id,
          status: statusCell || ''
        };
      }

      i++;
    }

    return map;
  }

  // -----------------------------
  // Extract task blocks, ensure ^ids in ledger, and group by project
  // -----------------------------
  extractBlocksAndEnsureIds(tasksRaw) {
    const lines = tasksRaw.split('\n');

    // Collect any existing ^ids to avoid duplicates
    const usedIds = new Set();
    for (const line of lines) {
      const m = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
      if (m) usedIds.add(m[1]);
    }

    const taskLineRe = /^\s*-\s\[\s\]\s+.*$/; // only open tasks show in projects
    const projTagRe = /#P(\d+)\b/gi;

    // blocks: { projectIds: [P#], start: index, end: index }
    const blocks = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!taskLineRe.test(line)) continue;

      // project tags on this line
      let tags = [];
      let m;
      while ((m = projTagRe.exec(line)) !== null) {
        tags.push('P' + m[1]); // e.g. P3
      }
      if (tags.length === 0) continue;

      const parentIndentMatch = line.match(/^\s*/);
      const parentIndentLen = parentIndentMatch ? parentIndentMatch[0].length : 0;

      let start = i;
      let end = i;

      // include nested lines
      let j = i + 1;
      while (j < lines.length) {
        const child = lines[j];
        if (child.trim() === '') break;

        const childIndentMatch = child.match(/^\s*/);
        const childIndentLen = childIndentMatch ? childIndentMatch[0].length : 0;
        if (childIndentLen <= parentIndentLen) break;

        end = j;
        j++;
      }

      blocks.push({ projectIds: tags, start, end });
      i = end;
    }

    // Ensure each block's first line has a ^id in the ledger
    for (const block of blocks) {
      const idx = block.start;
      const line = lines[idx];

      const existingIdMatch = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
      if (existingIdMatch) {
        // already has id
        usedIds.add(existingIdMatch[1]);
        continue;
      }

      // generate new id from first projectId + slug of content
      const primaryProjectId = block.projectIds[0] || 'P0';
      const newId = this.generateBlockId(primaryProjectId, line, usedIds);
      usedIds.add(newId);

      // append ^id at end of line
      lines[idx] = line + ` ^${newId}`;
    }

    // Now build tasksByProject using updated lines (with IDs)
    const tasksByProject = {};
    for (const block of blocks) {
      for (const projId of block.projectIds) {
        if (!tasksByProject[projId]) tasksByProject[projId] = [];
        const blockLines = [];
        for (let i = block.start; i <= block.end; i++) {
          blockLines.push(lines[i]);
        }
        tasksByProject[projId].push(blockLines);
      }
    }

    return {
      tasksByProject,
      updatedTasksRaw: lines.join('\n')
    };
  }

  // -----------------------------
  // Generate a simple, stable ^id for a task block
  // -----------------------------
  generateBlockId(projectId, firstLine, usedIds) {
    // Extract content after "- [ ] " if present
    let content = firstLine.trim();
    const bulletMatch = firstLine.match(/^(\s*-\s\[[ xX]\]\s+)(.*)$/);
    if (bulletMatch) {
      content = bulletMatch[2]; // text after "- [ ] "
    }

    // strip trailing @YYYY-MM-DD or existing ^id
    content = content.replace(/\s+@\d{4}-\d{2}-\d{2}$/, '');
    content = content.replace(/\s+\^[A-Za-z0-9_-]+$/, '');

    // cut off at first tag-like marker
    const cutIdx = content.search(/[#@^]/);
    if (cutIdx !== -1) {
      content = content.substring(0, cutIdx).trim();
    }
    if (!content) content = 'task';

    let slug = content.toLowerCase();
    slug = slug.replace(/[^a-z0-9]+/g, '-');
    slug = slug.replace(/-+/g, '-');
    slug = slug.replace(/^-|-$/g, '');
    if (!slug) slug = 'task';

    const MAX_SLUG_LEN = 40;
    if (slug.length > MAX_SLUG_LEN) {
      slug = slug.slice(0, MAX_SLUG_LEN);
      slug = slug.replace(/-+$/g, '');
    }

    let base = `${projectId.toLowerCase()}-${slug}`;
    let id = base;
    let counter = 2;
    while (usedIds.has(id)) {
      id = `${base}-${counter}`;
      counter++;
    }
    return id;
  }

  // -----------------------------
  // Summarize task blocks (per project)
  // -----------------------------
  summarizeTasks(taskBlocks) {
    const summary = {
      total: taskBlocks.length,
      today: 0,
      tomorrow: 0,
      thisweek: 0,
      nextweek: 0,
      nextfewdays: 0
    };

    for (const block of taskBlocks) {
      if (!block || block.length === 0) continue;
      const line = block[0].toLowerCase(); // first line

      if (line.includes('#today')) summary.today++;
      if (line.includes('#tomorrow')) summary.tomorrow++;
      if (line.includes('#thisweek')) summary.thisweek++;
      if (line.includes('#nextweek')) summary.nextweek++;
      if (line.includes('#nextfewdays')) summary.nextfewdays++;
    }

    return summary;
  }

  // -----------------------------
  // Build Existing Projects section
  // -----------------------------
  buildExistingProjectsSection(projectMap, tasksByProject) {
    let out = '# Existing Projects\n\n';

    const ids = Object.keys(tasksByProject);
    ids.sort((a, b) => {
      const na = parseInt(a.slice(1), 10);
      const nb = parseInt(b.slice(1), 10);
      if (isNaN(na) || isNaN(nb)) return a.localeCompare(b);
      return na - nb;
    });

    for (const id of ids) {
      const meta = projectMap[id] || { name: id, status: '' };

      // Status filter
      if (STATUS_FILTER) {
        const normalize = (s) =>
          (s || '').toLowerCase().replace(/[.!\s]+$/g, '');
        if (normalize(meta.status) !== normalize(STATUS_FILTER)) {
          continue;
        }
      }

      const taskBlocks = tasksByProject[id];
      if (!taskBlocks || taskBlocks.length === 0) continue;

      const heading = `## 📁 ${meta.name} (${id})`;
      out += `${heading}\n\n`;

      // Summary line
      const summary = this.summarizeTasks(taskBlocks);
      const pieces = [];
      if (summary.today > 0) pieces.push(`${summary.today} #today`);
      if (summary.tomorrow > 0) pieces.push(`${summary.tomorrow} #tomorrow`);
      if (summary.thisweek > 0) pieces.push(`${summary.thisweek} #thisweek`);
      if (summary.nextweek > 0) pieces.push(`${summary.nextweek} #nextweek`);
      if (summary.nextfewdays > 0) pieces.push(`${summary.nextfewdays} #nextfewdays`);

      out += `**Summary:** ${summary.total} open task${summary.total === 1 ? '' : 's'}`;
      if (pieces.length > 0) {
        out += ` (${pieces.join(', ')})`;
      }
      out += '\n\n';

      // Task blocks (already have ^ids in first lines from ledger)
      for (const block of taskBlocks) {
        for (const line of block) {
          out += line + '\n';
        }
        out += '\n';
      }
    }

    return out.trimEnd() + '\n';
  }

  // -----------------------------
  // Merge Existing Projects into Projects.md
  // -----------------------------
  mergeIntoProjectsFile(lines, newExistingSection) {
    const existingIdx = lines.findIndex((l) =>
      l.trim().toLowerCase().startsWith('# existing projects')
    );

    let prefixLines;
    if (existingIdx === -1) {
      prefixLines = [...lines];
      if (
        prefixLines.length > 0 &&
        prefixLines[prefixLines.length - 1].trim() !== ''
      ) {
        prefixLines.push('');
      }
    } else {
      prefixLines = lines.slice(0, existingIdx);
      while (
        prefixLines.length > 0 &&
        prefixLines[prefixLines.length - 1].trim() === ''
      ) {
        prefixLines.pop();
      }
      prefixLines.push('');
    }

    const prefix = prefixLines.join('\n');
    return (prefix + '\n' + newExistingSection).trimEnd() + '\n';
  }

  // -----------------------------
  // Collect completed ^ids from Projects.md
  // -----------------------------
  collectCompletedIdsFromProjects(lines) {
    const completedIds = new Set();

    const existingIdx = lines.findIndex((l) =>
      l.trim().toLowerCase().startsWith('# existing projects')
    );
    if (existingIdx === -1) {
      return completedIds;
    }

    for (let i = existingIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const isCompletedTask = /^\s*-\s\[[xX]\]\s+/.test(line);
      if (!isCompletedTask) continue;

      const m = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
      if (!m) continue;

      completedIds.add(m[1]);
    }

    return completedIds;
  }
}

module.exports = KineticProjectsLedgerPlugin;
