# Inbox (Dashboard)

## 🟡 Tasks Missing WHEN
```dataview
task
from "Tasks/Kinetic-Tasks.md"
where !completed
and !contains(file.path, "Project Files")
and !any(
  tags,
  (t) => regexmatch("^#asap$|^#tomorrow$|^#nextfewdays$|^#week$|^#month$|^#later$", t)
)
sort file.link, text
```

## Other Views
	 ## 🟣 Tasks Missing WHY
		%%```dataview
		task
		from "Tasks/Kinetic-Tasks.md"
		where !completed
		and !contains(file.path, "Project Files")
		and !any(
		  tags,
		  (t) => regexmatch("^#P\\d+$|^#who-|^#goal-|^#aor-", t)
		)
		sort file.link, text```%% 
	
	## 🟠 Tasks Missing BOTH WHY and WHEN
	%% ```dataview
	task
	from "Tasks/Kinetic-Tasks.md"
	where !completed
	and !contains(file.path, "Project Files")
	and !any(
	  tags,
	  (t) => regexmatch("^#P\\d+$|^#who-|^#goal-|^#aor-", t)
	)
	and !any(
	  tags,
	  (t) => regexmatch("^#asap$|^#tomorrow$|^#nextfewdays$|^#week$|^#month$|^#later$", t)
	)
	sort file.link, text
	``` %%
