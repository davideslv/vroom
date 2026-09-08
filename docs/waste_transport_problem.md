# Waste and materials transport: daily fleet planning problem

This document registers the real-world problem this fork of VROOM is
meant to address. It is a problem statement only; the analysis of how
(and whether) VROOM can solve it lives in
[waste_transport_vroom_analysis.md](./waste_transport_vroom_analysis.md).

Contents:
- [Context and goal](#context-and-goal)
- [Operations](#operations)
- [Containers](#containers)
  - [Stock at the company](#stock-at-the-company)
- [Trucks](#trucks)
- [Loading rules](#loading-rules)
- [No-go areas](#no-go-areas)
- [Constraints](#constraints)
- [Objective](#objective)
- [Dynamics: operations added during the day](#dynamics-operations-added-during-the-day)
- [Out of scope](#out-of-scope)
- [Non-functional requirements](#non-functional-requirements)
- [Open questions](#open-questions)

## Context and goal

A company transports waste containers and materials. Every morning
the planner has:

- a list of **operations** requested for the day (some may be
  carried over from previous days);
- a set of available **trucks** and **operators** (drivers).

The plan to produce is, for every truck: the ordered list of
operations it performs today and the route it drives. Operations that
do not fit today are left unassigned and move on to the next day's
planning. Assigning operators to trucks is done afterwards and is not
part of the optimisation.

The company site (referred to below as **the company**) is where the
trucks start and end the day, where full containers are emptied and
where empty containers and materials are stocked. It is a single fixed
location for a planning day, not something chosen per operation; its
coordinates, together with the other values a planner may change
(fleet size, working day, service times), live in
[waste_defaults.json](./waste_defaults.json).

## Operations

Four kinds of operations exist. Each one is a visit to a location that
changes what the truck carries.

| Operation | Location | Effect on the truck load |
| --- | --- | --- |
| Pick up a waste container | client site | a **full** container of a given size is loaded |
| Leave a waste container somewhere | disposal site, client, or the company | a **full** container is unloaded |
| Leave an empty container somewhere | client site | an **empty** container of a given size is unloaded |
| Deliver materials | client site | materials are unloaded |

Operations are coupled through the truck load:

- a full container picked up at a client has to be brought somewhere:
  usually back to the company to be emptied, sometimes directly to
  another place ("pure transport": pick up at A and leave at B without
  passing through the company);
- an empty container left at a client has to be on board first; empty
  containers come from the company;
- because a truck can only carry a few containers at a time, a
  typical day is a sequence of **trips**: go out, pick up and/or leave
  containers, come back to the company to unload, go out again.

A single client visit may combine operations (for instance leave an
empty container and pick up the full one standing there).

From the planner's point of view, requests come in four types, which
the planning tool translates into the movements above:

| Request type | Movements |
| --- | --- |
| Deliver an empty container | company to client, empty container |
| Pick up a full container | client to company, full container |
| Exchange an empty container for a full one | empty container company to client, full container client to company |
| Sell materials | company to client, a full container of materials |

A container collected at a client is always a **full** one: the truck
brings it back to the company to be emptied. Empty containers only
travel the other way, from the company to a client, so no request
takes an empty container away from a client.

Materials are sold in a container of one of the standard sizes that
leaves the company already full and stays at the client. For the
loading rules it is simply a full container of that size: other
containers can travel on the same truck, and even on the same axle.

## Containers

Container sizes: **2 m³, 6 m³, 12 m³, 20 m³, 40 m³**.

A container is either **empty** or **full**. The state matters: full
containers are heavy and cannot be stacked on top of anything, empty
ones can be nested or placed on top of others. Throughout this
document `eN` means an empty N m³ container and `fN` a full one
(`3e2` = three empty 2 m³ containers, `1f6` = one full 6 m³
container).

### Stock at the company

The company only has so many containers of each size standing in the
yard, and every operation that takes one out uses one up: delivering an
empty container, an exchange (which leaves an empty behind) and selling
materials (which leave in a container of that size). Picking up a full
container at a client does not; it brings one in.

So a day may ask for more containers of a size than the company has,
and then some of those operations cannot be done today whatever the
fleet does. Which ones are left for the next day is a planning
decision, not a fixed one: the planner states how many containers of
each size are available and the plan drops the ones that do not fit,
priority first (see [Objective](#objective)).

Containers brought back full during the day are emptied at the company
and could in principle go out again the same day; today's counts are
read as what is available for the day, without that turnover (see
open question 10).

## Trucks

Three truck types:

| Type | Containers it can handle |
| --- | --- |
| small | 2 m³ |
| multiban | 2, 6, 12 m³ |
| poliban | 20, 40 m³ |

Compatibility between containers and trucks is strict: a truck can
only carry the container sizes of its type.

### Chicos

A **chico** is a trailer that attaches to a truck. There are two
types, one for the multiban and one for the poliban. A truck with a
chico carries three times as much: its own bed plus two more on the
chico, and each bed takes any load allowed for the truck type, in any
mix. A multiban with a chico can for instance carry `1f6 + 3e2` on
its bed, `6e6` on the first chico bed and `1f12` on the second.

The company has a limited number of chicos of each type, fewer than
trucks. Whether a truck goes out with a chico is not decided by the
planner beforehand: the planning tool considers both possibilities
for every truck and chooses which trucks, if any, take a chico. What
a chico costs is expressed as a multiplier on its truck's cost per
kilometre; it is 1 (the trailer costs nothing extra) until the company
provides a figure.

## Loading rules

What a truck can carry at the same time is **not** a simple sum of
volumes or a count. It is a fixed list of allowed combinations,
decided by how containers physically sit on the truck (which ones can
go on top of or inside which). The authoritative lists provided by
the company are kept in **one place**,
[waste_rules.json](./waste_rules.json), which the planner, the check
scripts and the example instance all read. Anything not listed there
is assumed forbidden until confirmed otherwise (see open questions).

A combination that is "smaller" than an allowed one is also allowed
(if `6e2` is allowed, so is `4e2`).

Notation used in that file: `eN` an empty N m³ container, `fN` a full
one, `+` to combine (`2f6 + 1e2` = two full 6 m³ and one empty 2 m³).
Each truck type has one list of maximal allowed loads.

### Physical arrangements (informative only)

The mixed full-and-empty loads of the multiban come from how
containers sit on the truck; this does not constrain the plan (see the
notes below) but explains the list:

| Multiban load | Physical arrangement |
| --- | --- |
| `1f6 + 3e2` | the 2 m³ on top of the full 6 m³ |
| `2f6 + 1e2` | the 2 m³ on top of one of the full 6 m³ |
| `1f6 + 3e6` | full one below, empties on top |
| `1f12 + 1e2` | the 2 m³ on top of the full 12 m³ |

### Notes on the rules

- The arrangement column explains where the rules come from but does
  **not** constrain the plan: when loading or unloading at a site the
  operator can reorder the containers on the truck as needed. Only the
  *set* of containers on board matters, never their order.
- Modelling the multiban capacity is the main modelling difficulty.
  Earlier attempts based on additive quantities (volume, count) were
  incorrect because they either allowed forbidden combinations or
  forbade allowed ones.

## No-go areas

Some parts of the map are closed to some vehicles: narrow streets, a
historic centre, a low bridge. A truck concerned by such an area may not
even **drive through** it on its way somewhere else, so this is a
constraint on the route itself and not only on which clients it serves.

Today the only vehicles concerned are the ones going out with a chico:
the combination is long enough that some streets are out of the
question, and both chico types share the same areas. The areas are drawn
on the map by the planner, who knows them, rather than listed here; they
live in [no_go_zones.json](./no_go_zones.json). Nothing about the
mechanism is specific to chicos, and a truck type could be restricted
the same way (see
[no_go_zones.md](./no_go_zones.md#restricting-another-kind-of-vehicle)).

A client sitting inside an area closed to the chicos can still be
served, but only by a truck without one.

## Constraints

- **Working hours**: every truck has a start time and a finishing time
  for the day.
- **Lunch break**: every truck (operator) has a lunch break during the
  day, spent at the company: a truck is back at the company, unloaded,
  by the start of lunch, and loads nothing before its end. The day is
  therefore a morning shift and an afternoon shift, each starting and
  ending at the company.
- **Compatibility**: containers can only travel on trucks of a
  compatible type (see [Trucks](#trucks)).
- **Loading rules**: at every moment the load on a truck must be one
  of the allowed combinations for that truck (see
  [Loading rules](#loading-rules)).
- **Stock of containers**: no more operations taking a container out of
  the company can be done in a day than there are containers of that
  size in the yard (see [Stock at the company](#stock-at-the-company)).
- **Load conservation**: a container can only be left somewhere if it
  is on board; a full container picked up has to be unloaded somewhere
  (company or destination) before the end of the day.
- **Chicos**: a truck takes at most one chico, of the type matching
  the truck, for a whole shift; since lunch is spent at the company, a
  chico can be put on or taken off there over lunch. No more chicos go
  out than the company owns, and no more trucks than it has.
- **No-go areas**: a truck with a chico neither stops in nor drives
  through the areas closed to it (see [No-go areas](#no-go-areas)).
- **Unassigned operations are acceptable**: if not everything fits in
  the day, the leftover moves to the next day. Operations can carry a
  **priority** so that the planner controls which ones are dropped
  first.

## Objective

A good plan, in order of importance:

1. maximises the number of operations done today (weighted by
   priority);
2. minimises what the driving costs the company, which is the
   kilometres driven priced per truck type: fuel, tyres and wear
   differ between a small truck, a multiban and a poliban, and a truck
   towing a chico burns more per kilometre than the same truck alone.

Time is **not** part of the objective. The drivers are paid by the
month, so their hours are spent whether a truck goes out that day or
not; a plan that sends one more truck out to save kilometres is the
better plan, not the worse one. Time only sets what fits: the working
hours below are a limit, not a price.

Two things about a truck's day are priced all the same, and neither is
about the hours it drives. One is an **early start**, which really is
money: those hours are worked on top of the day, not inside it. The
other is **working the afternoon**, which is not — it is a preference,
that an operation which can be done in the morning should be. Clients
would rather be served early, and an afternoon that overruns has no
day left to absorb it. Both are stated per truck rather than per
kilometre or per hour: what the plan pays for is sending a truck out
early, and sending one out after lunch, however much either then does.
Both sit under point 1 above and so can never leave an operation
undone; they only choose between plans that do the same work. Their
prices are `costs.early_start_per_hour` and `costs.afternoon_fixed` in
`docs/waste_defaults.json`, both editable in the planner's Costs tab,
and both at 0 mean the plan of point 2 alone.

The afternoon price is worth 0 on most days, and that is not a
disclaimer but the point: when the morning and the afternoon are the
same length they are worth the same to the planner, and the day comes
out in the morning without being asked. It is a day cut unevenly — a
short morning against a long afternoon — where the afternoon is
genuinely the cheaper half and a price is what buys the morning back.

That said, the plan this gives is one of several defensible ones, and
which is wanted is a judgement rather than a fact: the cheapest day
puts the small cheap trucks on many trips, so it is also the day with
the most driving in it, and a plan that weighs hours instead uses
fewer, bigger, dearer trucks for less road and fewer truck-hours.
Rather than settle that in the model, the planner solves the day
several times over — the same operations, the same fleet, the same
prices, only the weight on an hour changing — and puts the plans side
by side with what each comes to in trucks, driving, kilometres and
money, for the planner to choose between. The plans on offer are the
`scenarios` block of `docs/waste_defaults.json`; the objective above
is the first of them.

## Dynamics: operations added during the day

From time to time a new operation is requested while the trucks are
already out, and it has to be fitted into the running plan without
discarding the work already done.

Implemented, in the planner's **Extra job** tab: the plan on screen is
taken as fixed and the job is slotted into it, rather than the day being
planned again. A clock says where the day stands ("it is now 11:20"),
which freezes every route up to the last stop its truck has already
left; the job is then offered to every place after that which can take
it — the loading rules, the end of the shift, the no-go areas and the
per-truck caps all still hold — and the two cheapest are shown, priced
in the kilometres they add at the price of the truck that would drive
them. A truck still in the yard is offered as a trip of its own, which
is the answer when nothing fits into a route.

The solver has nothing to do with this. Once the plan is fixed, all that
is missing to price a detour is how long the roads take, and that comes
from the same OSRM instances the plan itself was built on. Nothing is
committed: the tab says who could take the job and what it would cost,
which is what a dispatcher needs on the phone. Full description in
[extra_job.md](./extra_job.md).

## Out of scope

- Assigning operators to trucks (done manually afterwards).
- Anything happening inside the company site (queues at the
  unloading point, etc.).

## Non-functional requirements

- The fleet is small; latency is not an issue. A planning run taking
  several minutes is acceptable.
- Routing data (travel times and distances between locations) comes
  from an OSRM instance running alongside the planner. It is also what
  makes re-planning during the day possible: travel times from the
  current truck positions are obtained from OSRM on demand.

## Open questions

Points that need confirmation from the company before the model can
be finalised. They matter because the answer changes whether the rules
can be expressed exactly (see the analysis document).

1. **Unlisted mixtures on the multiban.** Several combinations that
   sit "between" listed ones are not in the list. Are they allowed?
   - `3e2 + 3e6` (empties of both small sizes together)
   - `1f2 + 1f6` (one full of each)
   - `1f2 + 3e2` (analogous to `1f6 + 3e2`)
   - `1e12 + 3e2` (analogous to `1e12 + 3e6`)
   - `1f12 + 1e6` (analogous to `1f12 + 1e2`)
   - `2e12` (two empty 12 m³ nested)
2. **`1f12 + 1f2`.** One description says a full 12 m³ can travel with
   a 2 m³ "full or empty"; the final list only has `1f12 + 1e2`. Which
   is right?
3. **Chicos.** Confirmed: two chico types (multiban, poliban), each
   adding two beds that take any allowed load of the truck type, and
   the planner decides which trucks take one. Still open: does a
   chico change anything else (driving speed, time to load and
   unload, places the truck cannot reach), and by how much does it
   raise the truck's cost per kilometre?
4. **Materials.** Confirmed: materials travel in a full container of
   a standard size and can share the truck with other containers.
   Still open: which sizes are used for materials, and does the
   container come back to the company later (as a normal pick-up)?
5. **Small truck with a full 2 m³.** Is `1f2 + 1e2` or `1f2 + 2e2`
   allowed on the small truck, or is a full 2 m³ always alone?
6. **Where empties come from.** Empties always come from the
   company: a container collected at a client is always full. Is
   there any exception, for instance a client site that stocks
   empties for another one?
7. **Disposal sites.** When a full container is "left somewhere" other
   than the company, is that a final drop (the container stays there)
   or does the truck wait and bring the container back?
8. **Unloading at the company.** Typical duration of a company visit
   (fixed part plus a per-container part), and whether the company has
   opening hours that constrain it.
9. **Stock turnover.** A container collected full during the day is
   emptied at the company. Is it available again the same day for
   another operation, and if so after how long? Today the stock is
   read as a plain count for the whole day, which is right when the
   turnover is slow and slightly pessimistic otherwise.
10. **No-go areas.** Which areas exactly, and are they really the same
   for the multiban chico and the poliban chico? Is any area closed to
   a truck type on its own (a poliban in a narrow centre, say), and are
   any of them closed only at certain hours? The first two answers cost
   nothing to apply; a per-truck-type area costs one more routing
   dataset, and a time-dependent one is not supported at all.
