# 

### Today's Mission:
*(1–2 lines max — what winning today looks like)*

---
%% TODAY_CARD_START %%

| Rank | Task |  P  |  A  |
| :--: | ---- | :-: | :-: |
|  1   |      |     |     |
|  2   |      |     |     |
|  3   |      |     |     |
|  4   |      |     |     |
|  5   |      |     |     |
|  6   |      |     |     |
|  7   |      |     |     |
|  8   |      |     |     |
|  9   |      |     |     |
**Total possible points: 0**
%% TODAY_CARD_END %%
```button
name 🔢 Score Today Card
type note template
action Score-Today-Card
```
^button-uj7l
---
## Candidate Tasks
### 🔴 ASAP / Today
```dataview
task
from "Tasks/Kinetic-Tasks.md"
where !completed
and contains(tags, "#asap")
sort text
```

### 🟠 Tomorrow
```dataview
task
from "Tasks/Kinetic-Tasks.md"
where !completed
and contains(tags, "#tomorrow")
sort text
```

### 🟡 Next Few Days
```dataview
task
from "Tasks/Kinetic-Tasks.md"
where !completed
and contains(tags, "#nextfewdays")
sort text
```

### 🟢 Within a Week
```dataview
task
from "Tasks/Kinetic-Tasks.md"
where !completed
and contains(tags, "#week")
sort text
```

---
## Capture
- 

## Notes

- 
