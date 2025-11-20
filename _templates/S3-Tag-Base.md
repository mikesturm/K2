<%*
const args = tp.args;
if (!args || args.length === 0) { new Notice("No S3 tag provided."); return; }
const newTag = args[0];
const S3 = ["#asap","#tomorrow","#nextfewdays","#week","#month","#later"];

const md = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
if (!md) { new Notice("No active note."); return; }

const editor = md.editor;
let lineNo = editor.getCursor().line;
let line = editor.getLine(lineNo);

if (!line.trim().startsWith("- [")) {
  new Notice("Cursor must be on a task line.");
  return;
}

for (const tag of S3) {
  const re = new RegExp("\\s*" + tag + "\\b","g");
  line = line.replace(re,"");
}

line = line.trimEnd() + " " + newTag;
editor.setLine(lineNo, line);
%>
