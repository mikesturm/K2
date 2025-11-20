<%*
async function scoreTodayCard() {
  const content = await tp.file.read();
  const lines = content.split('\n');

  const START = '%% TODAY_CARD_START %%';
  const END   = '%% TODAY_CARD_END %%';

  const startIdx = lines.findIndex(l => l.trim() === START);
  const endIdx   = lines.findIndex(l => l.trim() === END);

  // If markers aren't found or malformed, do nothing
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return;
  }

  const beforeLines = lines.slice(0, startIdx + 1);     // includes START line
  const middleLines = lines.slice(startIdx + 1, endIdx); // between markers
  const afterLines  = lines.slice(endIdx);              // includes END line

  // Extract the table lines (those that start with '|')
  const tableLines = middleLines.filter(l => l.trim().startsWith('|'));

  // Need at least header + separator
  if (tableLines.length < 2) {
    return;
  }

  const headerLine = tableLines[0];
  const sepLine    = tableLines[1];
  const dataLines  = tableLines.slice(2);

  // Parse rows into cells (assumes 3 columns: #, Task, Points)
  const parsed = dataLines.map(line => {
    const rawCells = line.split('|');
    // rawCells[0] is before the first '|', last element is after last '|'
    const cells = rawCells.slice(1, -1).map(c => c.trim());
    return { line, cells };
  });

  // Rows that actually have a Task in column 2 (index 1)
  const rowsWithTasks = parsed.filter(r => r.cells[1] && r.cells[1].length > 0);
  const n = rowsWithTasks.length;

  let totalPoints = 0;
  let currentRank = 1;

  const newDataLines = parsed.map(r => {
    const hasTask = r.cells[1] && r.cells[1].length > 0;

    if (hasTask) {
      const rank   = currentRank;
      const points = n - currentRank + 1; // n, n-1, ..., 1

      r.cells[0] = String(rank);   // # column
      r.cells[2] = String(points); // Points column

      totalPoints += points;
      currentRank++;
    } else {
      // Blank task row → blank rank & points
      r.cells[0] = '';
      r.cells[2] = '';
    }

    // Rebuild the markdown row
    const rebuilt = '| ' + r.cells.join(' | ') + ' |';
    return rebuilt;
  });

  const newTableLines = [headerLine, sepLine, ...newDataLines];

  // Rebuild the middle section: table + total line
  const newMiddleLines = [];
  newMiddleLines.push(...newTableLines);
  newMiddleLines.push('');
  newMiddleLines.push(`Total possible points: ${totalPoints}`);

  // Merge everything back together
  const newLines = [...beforeLines, ...newMiddleLines, ...afterLines];
  const newContent = newLines.join('\n');

  await tp.file.write(newContent);
}

// Run it, then output nothing into the note
await scoreTodayCard();
tR = '';
%>