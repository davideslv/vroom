# One more job, into a day already on the road

The day is planned in the morning and then the phone rings: a client
wants a container this afternoon. Who can still take it, and what does
it cost? That is the question the planner's **Extra job** tab answers,
and it answers it without planning the day again. Companion to
[waste_transport_problem.md](./waste_transport_problem.md) (the
"Dynamics" section states the requirement) and to
[no_go_zones.md](./no_go_zones.md).

Contents:
- [Why the day is not planned again](#why-the-day-is-not-planned-again)
- [Why VROOM is not involved](#why-vroom-is-not-involved)
- [What an insertion is](#what-an-insertion-is)
- [The clock: "it is now 11:20"](#the-clock-it-is-now-1120)
- [What makes an insertion impossible](#what-makes-an-insertion-impossible)
- [What is offered, and in what order](#what-is-offered-and-in-what-order)
- [Using the tab](#using-the-tab)
- [The pieces](#the-pieces)
- [Checking that it works](#checking-that-it-works)
- [Limits](#limits)

## Why the day is not planned again

Re-solving would be the wrong answer twice over.

The trucks are out. Half of what the plan says has physically happened:
a container is standing at a client, another is on a truck heading
north. A new plan is free to move any of it, and a plan that moves work
already done is not a plan, it is a fiction. It would also arrive as a
completely different day — the solver's search is not incremental, so
adding one operation can reshuffle every route — and the planner has no
way to tell nine drivers that their afternoon is now something else.

Taking the plan as fixed and slotting the job into it is a smaller
question with a much better answer: exactly one truck's route changes,
by a detour the planner can read in a line, and everybody else's day is
untouched. It is also the answer a dispatcher gives on the phone, which
is what the tab is for.

## Why VROOM is not involved

Once the plan is fixed, the only thing missing to price a detour is how
long the roads take. That is not a solver question, it is a routing
question, and it goes straight to the same OSRM instances the solver
itself used: one `table` request per routing profile in play returns
every travel time and distance between the stops already planned, the
company and the new client, and every possible insertion is then
arithmetic on that table. The detour costs here exactly what it will
cost in the plan, because the numbers come from the same place.

The browser cannot reach the routing containers on its own, so
`frontend/server.js` passes the two read-only services through at
`/osrm/<profile>/table/v1/...` and `/osrm/<profile>/route/v1/...`, using
the `host_port` of that profile in [no_go_zones.json](./no_go_zones.json).
`table` prices the options; `route` draws the one being looked at.

## What an insertion is

An operation is not one stop. Every one of them has an end at the
company — a container is loaded in the yard before it can be delivered,
a full one is emptied there after it is picked up — so a job is a small
chain of stops that has to go into the route in that order:

| Operation | The chain |
| --- | --- |
| deliver an empty | company (load empty) → client (drop it) |
| materials | company (load full) → client (drop it) |
| pick up a full | client (load it) → company (empty it) |
| exchange | company (load empty) → client (swap) → company (empty it) |

The company ends are usually free. A route starts and finishes at the
company and often passes through it in between to empty what it is
carrying, so a company stop the chain needs is first looked for among
the ones the truck already makes: loading one more container while it is
standing in the yard costs the handling time and not a metre of road.
Only when no such stop is available, or when a detour through the yard
is genuinely cheaper, is a new company visit inserted.

The client stop is always new, and it may go into any gap between two
consecutive stops the truck has not yet driven.

Every combination of those placements is enumerated and priced. Routes
are a handful of stops long, so this stays a few thousand possibilities
per truck even on a full day, and the answer is instant.

## The clock: "it is now 11:20"

The planner is in the middle of the day, so most of the plan is history
and must not be touched. The clock at the top of the tab is what the
question is asked at, and it freezes the route up to the last stop the
truck has already left:

- a gap is open only if the truck is still standing at the stop before
  it;
- a truck driving between two stops has left the first, so that gap is
  closed and the job can only go in after it arrives;
- everything before the freeze keeps the times it was planned with, and
  everything after it moves later by what the detour adds.

The clock is a simulation: it is set by hand (or from the real clock
with one button), so the same job can be tried at nine in the morning
and at half past three and the answers compared. Nothing outside this
tab reads it.

## What makes an insertion impossible

Four things, all of them checked here because the solver is not there to
check them:

- **the day** — the truck must still be back at the company by the end
  of its shift. Lunch is spent at the company, so the morning and the
  afternoon are separate shifts (see `shiftsOf` in
  `frontend/public/waste_model.js`) and a job that would push a truck
  past noon is simply not offered on the morning shift;
- **the load** — the containers already on the truck plus the new one
  must fit one of the loading rules of that truck type
  ([waste_rules.json](./waste_rules.json)), at every stop between
  picking it up and dropping it. A multiban carrying two full 6 m³
  containers is full, and no third one goes on it however near it
  passes;
- **the roads** — a client inside a no-go zone is only offered to trucks
  whose routing profile may enter it;
- **the caps** — `max_travel_time`, `max_distance` and `max_tasks` are
  per truck and per shift, and a route breaking one of them is not a
  plan at all.

What is deliberately *not* enforced is the container stock. Whether the
yard still holds an empty of that size is a fact about the yard, not
about the route, and the planner standing in front of it knows better
than the browser does: when the day already hands out every container of
that size, the tab says so and offers the options anyway.

## What is offered, and in what order

Every feasible insertion is priced the way the plan itself is priced —
the kilometres it adds at the price of the truck that would drive them,
see the cost model in `waste_model.js` — and the cheapest are offered
first, one per truck: the second-best way of fitting the job into the
same route is not a second option to a dispatcher, it is the same phone
call.

Two of them are shown. The planner is making a phone call, not reading a
report, and the second option is there because the best one on paper may
be the one truck whose driver cannot take another call today.

A truck standing in the yard is offered too, as a trip of its own —
which is what the answer has to be when nothing fits into a route. That
includes a truck that is already back from its round with hours of its
shift left. Such a trip is ranked no differently from a detour: it is
simply an expensive one, which is exactly what it is.

Each option shows the truck, what it adds in kilometres, in time and in
money, and the rest of that driver's shift with the new stops woven into
it and the delay each existing stop picks up. The map draws the day it
would change, faint, with that truck's remaining route over it, drawn
along the real roads.

**Nothing is committed.** The tab answers a question; it does not touch
the day, the operation list or the plan. Giving the job to the truck is
a phone call, and putting it into tomorrow's plan is an operation added
on the Plan tab like any other.

## Using the tab

1. Plan the day on the **Plan** tab as usual. An extra job is fitted
   into the plan on screen — the scenario currently selected, not the
   last one solved, so picking another scenario and asking again
   compares the two.
2. Open **Extra job** and set the clock to the moment the call comes in.
   The line next to it says what that leaves: how many trucks are on the
   road and how many stops are still to come.
3. Say what the job is (operation, container size) and where: click the
   map, or type a latitude and longitude. While this tab is open a click
   on the map moves the job rather than adding an operation to the day.
4. Press **Where does it fit?**. The two cheapest places come back;
   clicking a card puts that one on the map.

## The pieces

| File | What it does |
| --- | --- |
| `frontend/public/waste_insert.js` | the whole of the arithmetic: the chain of stops, the placements, the checks and the pricing. No DOM, no fetching, so it runs under node as well as in the browser |
| `frontend/public/index.html` | the tab: the clock, the job, the option cards and the map preview |
| `frontend/server.js` | `/osrm/<profile>/...`, the browser's way to the routing containers |
| `scripts/extra_job_check.js` | the checks below |

## Checking that it works

```
node scripts/extra_job_check.js
```

A crafted plan and a made-up travel-time table, so every number in it
can be worked out on paper: the new client sits two kilometres off the
road between the two stops the truck is already making, and forty
kilometres from the company. Each check then reads as a sentence — a
third full container may not go between the two pickups, the same job
with room on the truck costs two kilometres, a gap the truck is already
driving is closed, a cap keeps the job out of the route — and the script
exits non-zero if any of them stops being true.

For the round trip through the real thing, plan a day in the planner and
ask the tab; the browser console has `INS`, `extraAnswer` and
`osrmTable` if the numbers need to be taken apart.

## Limits

Worth knowing before trusting an answer:

- **The plan is fixed, so the answer is a detour and not an optimum.**
  A day re-planned around the new job might do better than any of the
  options here. That is the trade: this answer is one truck's change,
  arrives instantly, and can be acted on over the phone.
- **Only one job at a time.** Two calls are two questions, and the
  second one is asked against a plan that does not yet contain the
  first.
- **Where the trucks really are is not known.** The freeze uses the
  planned times, not GPS: a truck running twenty minutes late is
  assumed to be where the plan says. The clock is the only handle on
  that, and moving it forward is the honest way to allow for a day that
  is running late.
- **Nothing is committed, so nothing is remembered.** Ask the same
  question after changing the day and the previous answer is dropped,
  because it was about a plan that no longer exists.
