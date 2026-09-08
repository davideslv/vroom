// Fitting one more job into a day that is already on the road.
//
// The planner's day is solved once, in the morning, and then the phone
// rings. What this file does is answer the question that follows —
// "who can still take it, and what does it cost?" — without solving
// anything again. Re-solving would be the wrong answer twice over: the
// trucks are already out and half their stops are done, so a new plan
// could move work that has physically happened, and the planner has no
// way to tell a driver that the morning was different from what they
// were given. So the plan on screen is taken as fixed and the job is
// slotted into it, which is a smaller question with a much better
// answer: one truck's route changes, everyone else's day is untouched.
//
// It follows that VROOM has nothing to do here. The only thing missing
// to price a detour is how long the roads take, and that comes from
// OSRM directly: one `table` request per routing profile in use gives
// every travel time and distance between the stops already planned, the
// company and the new client, and every insertion is then arithmetic on
// those. The solver is not asked, not started, not needed.
//
// ---------- what an insertion is ----------
//
// An operation is not one stop. Every one of them has an end at the
// company (see buildRequest in waste_model.js): a container is loaded
// in the yard before it can be delivered, and a full one is emptied
// there after it is picked up. So a job is a small chain of stops that
// has to go into the route in order:
//
//   deliver empty    company (load empty)  ->  client (drop it)
//   materials        company (load full)   ->  client (drop it)
//   pick up full     client (load it)      ->  company (empty it)
//   exchange         company (load empty)  ->  client (swap)  ->  company (empty it)
//
// The company ends are usually free. A route starts and finishes at the
// company, and often passes through it in between to empty what it is
// carrying, so a company stop the chain needs is first looked for among
// the ones the truck already makes: loading one more container while it
// is standing in the yard costs the handling time and not a metre of
// road. Only when no such stop is available, or when a detour through
// the yard is genuinely cheaper, is a new company visit inserted.
//
// The client stop is always new, and it may go into any gap between two
// consecutive stops of the route that the truck has not yet driven.
//
// ---------- what "already at time x" means ----------
//
// The planner is in the middle of the day, so most of the plan is
// history and must not be touched. `now` is the clock the question is
// asked at, and it freezes the route up to the last stop the truck has
// already left: a gap is open only if the truck is still standing at
// the stop before it. A truck driving between two stops has left the
// first, so that gap is closed and the job can only go in after it
// arrives. Everything before the freeze keeps the times it was planned
// with; everything after it moves later by what the detour adds.
//
// ---------- what makes an insertion impossible ----------
//
// Four things, all of them checked here because the solver is not
// there to check them:
//
//   the day     the truck must still be back at the company by the end
//               of its shift (lunch is spent there, so the morning and
//               the afternoon are separate shifts, see shiftsOf)
//   the load    the containers already on the truck plus the new one
//               must fit one of the loading rules of that truck type,
//               at every stop between picking it up and dropping it
//   the roads   a client inside a no-go zone is only offered to trucks
//               whose routing profile may enter it
//   the caps    max_travel_time, max_distance and max_tasks are per
//               truck and shift, and a route breaking one is not a
//               plan at all
//
// What is deliberately not checked is the container stock: whether the
// yard still holds an empty of that size is a fact about the yard,
// not about the route, and the planner standing in front of it knows
// better than this file does. It is reported as a note instead.
//
// ---------- what comes back ----------
//
// Every feasible insertion is priced the way the plan itself is priced
// — the kilometres it adds at the price of the truck that would drive
// them (see the cost model in waste_model.js) — and the cheapest ones
// are offered, best first. Two of them, by default: the planner is
// making a phone call, not reading a report, and the second option is
// there because the best one on paper may be the one truck whose driver
// cannot take another call today.
//
// A truck standing in the yard is offered too, as a trip of its own,
// which is what the answer has to be when nothing fits into a route.
//
// Usage, in two steps because the travel times are fetched in between:
//
//   const I = WasteInsert.create(model);
//   const q = I.prepare({...});          // what to ask OSRM
//   const r = I.evaluate(q, matrices);   // the options, best first
//
// See frontend/public/index.html (the Extra job tab) for the whole
// round trip and docs/extra_job.md for the planner-facing description.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WasteInsert = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // How many places to offer. Two, because that is what a planner on
  // the phone can hold in their head, and because the difference
  // between the first and the second is the useful part of the answer.
  const OPTIONS = 2;

  // Coordinates are matched by their text, to six decimals (about
  // 10 cm), which is how the company site and every operation reach
  // both VROOM and OSRM. Anything nearer than that is the same place.
  function keyOf(point) {
    return `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
  }

  function create(M) {
    if (!M || typeof M.buildRequest !== "function") {
      throw new Error("WasteInsert.create expects a WasteModel");
    }

    // The stops one operation adds to a route, in the order they have
    // to happen. `at` is where the stop is; `amount` is what the truck
    // is carrying from this stop until the next one of the chain.
    // Wording follows buildRequest, so a planner reads the same
    // sentences here as in the plan itself.
    function chainOf(op, times) {
      const size = op.size;
      const client = (text, service) => ({ where: "client", text, service });
      const company = (text) => ({ where: "company", text, service: times.companyService });
      switch (op.type) {
        case "deliver_empty":
          return [
            { ...company(`load empty ${size} m³ at the company`), amount: M.oneHot(`e${size}`) },
            { ...client(`deliver empty ${size} m³`, times.clientService), amount: null },
          ];
        case "sell_materials":
          return [
            { ...company(`load materials (${size} m³ container) at the company`), amount: M.oneHot(`f${size}`) },
            { ...client(`deliver materials (${size} m³ container)`, times.clientService), amount: null },
          ];
        case "pickup_full":
          return [
            { ...client(`pick up full ${size} m³`, times.clientService), amount: M.oneHot(`f${size}`) },
            { ...company(`empty full ${size} m³ at the company`), amount: null },
          ];
        case "exchange":
          // One stop at the client: the empty comes off and the full
          // goes on, which is two container movements and so twice the
          // handling time, but a single visit.
          return [
            { ...company(`load empty ${size} m³ at the company`), amount: M.oneHot(`e${size}`) },
            { ...client(`swap empty for full ${size} m³`, 2 * times.clientService), amount: M.oneHot(`f${size}`) },
            { ...company(`empty full ${size} m³ at the company`), amount: null },
          ];
        default:
          throw new Error(`unknown operation type ${op.type}`);
      }
    }

    // How many VROOM tasks the operation is, which is what a max_tasks
    // cap counts: two shipment steps per movement, four for an
    // exchange.
    function tasksOf(op) {
      return op.type === "exchange" ? 4 : 2;
    }

    const leq = (a, b) => a.every((x, i) => x <= b[i]);
    const addVec = (a, b) => a.map((x, i) => x + (b ? b[i] : 0));

    // Does this load fit the truck? The loading rules are alternative
    // capacity vectors and a load is allowed as soon as it fits one of
    // them (docs/API.md, "capacities"), which is what the solver
    // checked when it built the plan.
    function fits(load, caps) {
      return caps.some((c) => leq(load, c));
    }

    // ---------- the plan, as the inserter reads it ----------

    // One route of the solution, normalised: its stops with the times
    // they were planned at, where the truck stands at `now`, and what
    // the truck is.
    function routeOf(r, info, shift, now, company, names) {
      const steps = (r.steps || []).map((s) => ({
        type: s.type,
        id: s.id,
        loc: s.location,
        key: s.location ? keyOf(s.location) : null,
        arrival: s.arrival,
        // A step's own time on site: waiting for a time window (there
        // are none in this model, so always 0), the setup paid on
        // arriving somewhere new, and the handling itself.
        hold: (s.waiting_time || 0) + (s.setup || 0) + (s.service || 0),
        load: s.load || null,
        description: s.description || "",
        atCompany: s.location ? keyOf(s.location) === company.key : false,
      }));
      if (steps.length < 2) return null;
      // Departure from each stop, which is what the freeze is about:
      // a truck that has left is past changing.
      let frozen = steps.length; // no gap open at all
      for (let i = 0; i < steps.length; i++) {
        const departure = steps[i].arrival + steps[i].hold;
        steps[i].departure = departure;
        if (frozen === steps.length && departure >= now) frozen = i;
      }
      return {
        vehicle: r.vehicle,
        type: info.type,
        chico: info.chico || null,
        profile: info.profile,
        shift,
        name: (names || {})[r.vehicle] || `${info.type} ${r.vehicle}`,
        caps: info.chico ? M.chicoCapacitiesFor(info.chico) : M.capacitiesFor(info.type),
        steps,
        frozen,
        // What the route comes to today, for the caps that are per
        // vehicle and per shift.
        travel: r.duration || 0,
        distance: r.distance == null ? null : r.distance,
        tasks: steps.filter((s) => s.type !== "start" && s.type !== "end").length,
        // A trip built out of nothing for a truck still in the yard, as
        // opposed to a route that came back from the solver.
        spare: false,
      };
    }

    // A truck standing in the yard, as a route with nothing in it: it
    // leaves the company when the job is ready to start and comes
    // straight back. Written as a two-step route so that everything
    // below — the gaps, the company stops, the arithmetic — works on it
    // unchanged. This is both the truck that was never sent out and the
    // one that is already home with hours of its shift left, which is
    // why `start` is a parameter and not simply the start of the shift.
    function spareRouteOf({ type, chico, shift, start, company, name, vehicle }) {
      const step = (kind) => ({
        type: kind, id: null, loc: company.loc, key: company.key,
        arrival: start, departure: start, hold: 0,
        load: M.KINDS.map(() => 0), description: "", atCompany: true,
      });
      return {
        vehicle: vehicle === undefined ? null : vehicle,
        type,
        chico: chico || null,
        profile: M.profileFor({ type, chico: chico || null }),
        shift,
        name,
        caps: chico ? M.chicoCapacitiesFor(chico) : M.capacitiesFor(type),
        steps: [step("start"), step("end")],
        frozen: 0,
        travel: 0,
        distance: 0,
        tasks: 0,
        // A trip of its own rather than a detour, which is worth saying
        // to the planner and worth knowing here: the times it is
        // compared against are of a route that does not exist yet, so
        // nothing in it is "later than planned".
        spare: true,
      };
    }

    // ---------- step one: what to ask OSRM ----------
    //
    //   solution, vehicleInfo   the plan on screen and what its
    //                           vehicles are (from WasteModel.buildRequest)
    //   truckNames              vehicle id -> the name the plan shows,
    //                           so an option names the same truck the
    //                           route cards do
    //   op                      {lat, lng, type, size} — the new job
    //   now                     seconds since midnight: the clock the
    //                           question is asked at
    //   depot, times, costs, limits, fleet, stock, operations
    //                           the day the plan was made with
    //
    // Returns the routes worth looking at and, per routing profile, the
    // points whose travel times are needed. `problems` is filled when
    // there is nothing to look at, in which case there is nothing to
    // ask OSRM either.
    function prepare({ solution, vehicleInfo, truckNames, op, now, depot, times,
                       costs, limits, fleet, stock, operations }) {
      const problems = [];
      const notes = [];
      times = Object.assign(M.defaultTimes(), times || {});
      limits = Object.assign(M.defaultLimits(), limits || {});
      costs = costs || M.defaultCosts();
      fleet = Object.assign(M.defaultFleet(), fleet || {});

      const type = M.OPERATION_TYPES[op && op.type];
      if (!type) problems.push(`Pick what the job is.`);
      if (type && type.needsSize && !M.SIZES.includes(Number(op.size))) {
        problems.push(`${op.size} m³ is not a container size.`);
      }
      if (!op || !isFinite(op.lat) || !isFinite(op.lng)) {
        problems.push("The job needs a latitude and a longitude.");
      }
      if (problems.length) return { problems, notes, routes: [], points: {} };

      const client = { loc: [Number(op.lng), Number(op.lat)] };
      client.key = keyOf(client.loc);
      const company = { loc: [Number(depot.lng), Number(depot.lat)] };
      company.key = keyOf(company.loc);

      // A client inside a no-go zone can only be served by trucks whose
      // routing profile is allowed in (docs/no_go_zones.md). The
      // profiles that cannot get there are dropped, rather than being
      // offered a route that quietly drives around the world.
      const blocked = new Set(M.blockedProfilesAt(client.loc[0], client.loc[1]));

      const shifts = M.shiftsOf(times);
      const shiftOf = {};
      for (const s of shifts) shiftOf[s.key] = s;

      const chain = chainOf({ ...op, size: Number(op.size) }, times);
      const routes = [];
      const skipped = { done: 0, zone: 0 };

      for (const r of solution.routes || []) {
        const info = vehicleInfo[r.vehicle];
        if (!info) continue;
        const shift = shiftOf[info.shift] || shifts[0];
        if (!shift) continue;
        if (blocked.has(info.profile)) { skipped.zone++; continue; }
        const route = routeOf(r, info, shift, now, company, truckNames);
        if (!route) continue;
        if (route.frozen >= route.steps.length) {
          // The truck has driven its whole route and is standing in the
          // yard. There is nothing left to insert into, but there may
          // well be hours of its shift left, so it is offered a second
          // trip instead of being dropped.
          skipped.done++;
          if (shift.end > now) {
            routes.push(spareRouteOf({
              type: route.type, chico: route.chico, shift, start: now,
              company, name: route.name, vehicle: route.vehicle,
            }));
          }
          continue;
        }
        routes.push(route);
      }

      // Trucks that were not sent out in this shift at all. A vehicle
      // group caps every version of a truck at the number of physical
      // trucks, so the routes of a type in a shift are exactly the
      // trucks of that type out in it, and the rest are in the yard.
      for (const shift of shifts) {
        if (shift.end <= now) continue;
        for (const t of M.TYPE_ORDER) {
          const out = (solution.routes || []).filter((r) => {
            const info = vehicleInfo[r.vehicle];
            return info && info.type === t && (shiftOf[info.shift] || shifts[0]).key === shift.key;
          }).length;
          const spare = (fleet[t] || 0) - out;
          if (spare <= 0) continue;
          const profile = M.profileFor({ type: t, chico: null });
          if (blocked.has(profile)) { skipped.zone++; continue; }
          const label = (M.TRUCK_TYPES[t] || { label: t }).label.toLowerCase();
          routes.push(spareRouteOf({
            type: t, chico: null, shift, start: Math.max(now, shift.start),
            company, name: `${label} ${out + 1}`,
          }));
        }
      }

      if (!routes.length) {
        problems.push(skipped.zone && !skipped.done
          ? "No truck may enter the area this job is in."
          : `Nothing is still on the road at ${M.clockOf(now)}.`);
      }

      // The yard is a fact about the yard: whether an empty of that
      // size is still there is something the planner can see and this
      // file cannot, so it is said and not enforced.
      if (M.takesContainerOut({ type: op.type })) {
        const size = Number(op.size);
        const held = M.stockFor(stock || {}, size);
        if (held !== null) {
          const used = M.stockUsers(operations || [], size).length;
          if (used >= held) {
            notes.push(`The day already hands out all ${held} of the ${size} m³ containers in the yard. ` +
                       "This job needs one more, so it only works if one has come back.");
          }
        }
      }
      if (skipped.zone) {
        notes.push(`${skipped.zone} truck${skipped.zone === 1 ? "" : "s"} left out: the job is inside an area ` +
                   "they may not drive through.");
      }

      // One matrix per routing profile, over the company, the new
      // client and every stop of the routes that use it. The stops of a
      // route are what a detour is measured against, so they belong in
      // the matrix as much as the new point does.
      const points = {};
      const index = {};
      for (const route of routes) {
        const p = route.profile;
        if (!points[p]) {
          points[p] = [company.loc, client.loc];
          index[p] = { [company.key]: 0, [client.key]: 1 };
        }
        for (const s of route.steps) {
          if (!s.key || index[p][s.key] !== undefined) continue;
          index[p][s.key] = points[p].length;
          points[p].push(s.loc);
        }
      }

      return {
        problems, notes, routes, points, index,
        client, company, chain, op: { ...op, size: Number(op.size) },
        now, times, costs, limits,
        tasks: tasksOf(op),
      };
    }

    // ---------- step two: every insertion, priced ----------

    // The placements a stop of the chain can take in a route, given
    // that the one before it lands at `after`:
    //   {at: i}    the truck already stops there, so this costs its
    //              handling time and no road at all (company stops only)
    //   {gap: g}   a new stop between steps g and g+1
    // Positions are ordered on a half-integer line, an existing stop at
    // i and a new stop in the gap after it at i + 0.5, which is all the
    // ordering the chain needs.
    function placementsFor(stop, route, after) {
      const out = [];
      const last = route.steps.length - 1;
      if (stop.where === "company") {
        for (let i = Math.max(route.frozen, 0); i <= last; i++) {
          if (!route.steps[i].atCompany) continue;
          if (i < after) continue;
          out.push({ at: i, pos: i });
        }
      }
      for (let g = route.frozen; g < last; g++) {
        if (g + 0.5 < after) continue;
        out.push({ gap: g, pos: g + 0.5 });
      }
      return out;
    }

    // One candidate: the chain's stops placed in a route. Returns null
    // when it cannot be done, and otherwise everything the planner is
    // shown about it.
    function evaluateCandidate(q, route, mat, placement) {
      const steps = route.steps;
      const last = steps.length - 1;
      const chain = q.chain;

      // The new stops, gathered by the gap they go into, and the extra
      // handling time at the stops the truck already makes.
      const inserted = {};   // gap -> [stop]
      const hosted = {};     // step index -> seconds of extra handling
      for (let c = 0; c < chain.length; c++) {
        const stop = chain[c];
        const where = placement[c];
        if (where.at !== undefined) hosted[where.at] = (hosted[where.at] || 0) + stop.service;
        else (inserted[where.gap] = inserted[where.gap] || []).push(stop);
      }
      // The last stop of a route is the truck coming home with nothing
      // to do there, so it pays no setup. Give it something to do and
      // the setup is paid now — unless the truck was already at the
      // company just before, in which case it never left the yard and
      // there is nothing to set up.
      if (hosted[last] !== undefined) {
        const before = (inserted[last - 1] || []).slice(-1)[0];
        const cameFromCompany = before ? before.where === "company" : steps[last - 1].atCompany;
        if (!cameFromCompany) hosted[last] += q.times.companySetup;
      }

      // What the truck carries on top of its planned load, from each
      // stop of the chain until the next one: the container it takes on
      // there, and nothing once it has handed it over. An exchange
      // leaves with an empty and comes back with a full one, so what it
      // carries changes at the client rather than adding up.
      const zero = M.KINDS.map(() => 0);
      const extraLoad = []; // by position on the half-integer line
      for (let c = 0; c < chain.length; c++) {
        extraLoad.push({ from: placement[c].pos, load: chain[c].amount || zero });
      }
      const loadAt = (pos) => {
        let load = zero;
        for (const e of extraLoad) if (e.from <= pos) load = e.load;
        return load;
      };

      // The load has to fit the truck at every stop it carries the new
      // container past, the new stops included.
      for (let i = route.frozen; i <= last; i++) {
        const extra = loadAt(i);
        if (extra === zero) continue;
        const load = steps[i].load;
        if (!load) continue; // no capacity reported: nothing to check against
        if (!fits(addVec(load, extra), route.caps)) return null;
      }

      // Walking the route from where the truck stands, adding the
      // detours as they come. Everything before the freeze keeps the
      // clock it was planned with; from there on the timeline is what
      // the rest of the driver's shift would look like.
      let clock = steps[route.frozen].arrival;
      let travel = 0;      // seconds of extra driving
      let metres = 0;      // metres of extra driving
      const timeline = []; // the rest of the shift, the new stops in it
      const sequence = [steps[route.frozen].loc];
      let delayed = 0;     // stops of the plan that happen later than planned

      const planned = (step, at) => ({
        kind: step.type === "start" ? "start" : step.type === "end" ? "end" : "planned",
        text: step.description || (step.type === "start" ? "leaves the company" : "back at the company"),
        at,
        // A trip that does not exist yet is not late: only the stops of
        // a route the driver already has can move.
        moved: route.spare ? 0 : at - step.arrival,
      });
      // The stops of the chain that this step of the route takes on.
      const hostedHere = (i) => chain.filter((s, c) => placement[c].at === i);

      for (let i = route.frozen; i <= last; i++) {
        // Coming home is the last line of the day, so whatever the
        // truck does at the company on arriving is said before it.
        if (i === last && hosted[last] !== undefined) {
          for (const s of hostedHere(last)) timeline.push({ kind: "new", text: s.text, at: clock, moved: 0 });
          clock += steps[last].hold + hosted[last];
          timeline.push(planned(steps[last], clock));
          if (!route.spare && clock > steps[last].arrival) delayed++;
          break;
        }
        timeline.push(planned(steps[i], clock));
        if (!route.spare && clock > steps[i].arrival) delayed++;
        // A job hosted by a stop the truck already makes happens while
        // it is standing there, after what it came for.
        if (hosted[i] !== undefined) {
          const at = clock + steps[i].hold;
          for (const s of hostedHere(i)) timeline.push({ kind: "new", text: s.text, at, moved: 0 });
        }
        clock += steps[i].hold + (hosted[i] || 0);
        if (i === last) break;

        const gap = inserted[i] || [];
        let from = steps[i].key;
        for (const stop of gap) {
          const to = stop.where === "company" ? q.company.key : q.client.key;
          const leg = mat.leg(from, to);
          if (!leg) return null;
          travel += leg.duration;
          metres += leg.distance;
          clock += leg.duration;
          timeline.push({ kind: "new", text: stop.text, at: clock, moved: 0 });
          clock += stop.service + (stop.where === "company" ? q.times.companySetup : 0);
          sequence.push(stop.where === "company" ? q.company.loc : q.client.loc);
          from = to;
        }
        const on = mat.leg(from, steps[i + 1].key);
        if (!on) return null;
        clock += on.duration;
        if (gap.length) {
          // What the detour really costs is the difference: the road
          // through the new stops, less the road the truck would have
          // driven anyway.
          const straight = mat.leg(steps[i].key, steps[i + 1].key);
          if (!straight) return null;
          travel += on.duration - straight.duration;
          metres += on.distance - straight.distance;
        }
        sequence.push(steps[i + 1].loc);
      }

      const endBefore = steps[last].arrival + (steps[last].hold || 0);
      const endAfter = clock;
      // The shift is the hard wall: a truck is back at the company and
      // unloaded by the end of it, lunch being spent there.
      if (endAfter > route.shift.end) return null;
      // The caps are per truck and per shift, and a route breaking one
      // is not a plan at all.
      const lim = q.limits;
      if (lim.maxTravelTime > 0 && route.travel + travel > lim.maxTravelTime) return null;
      if (lim.maxDistance > 0 && route.distance != null && route.distance + metres > lim.maxDistance) return null;
      if (lim.maxTasks > 0 && route.tasks + q.tasks > lim.maxTasks) return null;

      const money = M.moneyPerKm(M.configKeyOf(route.type, route.chico), q.costs) * (metres / 1000);
      return {
        route,
        name: route.name,
        vehicle: route.vehicle,
        spare: route.spare,
        shift: route.shift,
        extraDuration: endAfter - endBefore,
        extraTravel: travel,
        extraDistance: metres,
        extraMoney: money,
        endBefore,
        endAfter,
        shiftEnd: route.shift.end,
        delayed,
        timeline,
        // Where the truck goes from here, for drawing the option: the
        // stop it is standing at (or driving to) and everything after
        // it, the new stops included.
        sequence,
      };
    }

    // Every way the job fits, best first. `matrices` holds one OSRM
    // table answer per profile of `prepared.points`, in the same order:
    //   {car: {durations: [[...]], distances: [[...]]}, ...}
    function evaluate(prepared, matrices, wanted) {
      const options = [];
      let considered = 0;
      for (const route of prepared.routes) {
        const table = (matrices || {})[route.profile];
        const index = prepared.index[route.profile];
        if (!table || !index) continue;
        const mat = {
          leg(a, b) {
            const i = index[a], j = index[b];
            if (i === undefined || j === undefined) return null;
            const duration = table.durations[i][j];
            const distance = table.distances ? table.distances[i][j] : 0;
            if (duration === null || duration === undefined) return null;
            return { duration: Math.round(duration), distance: Math.round(distance || 0) };
          },
        };

        // Every placement of the chain, in order. The routes are a
        // handful of stops long, so this stays a few thousand
        // possibilities per truck even for a full day.
        const chain = prepared.chain;
        const walk = (c, after, sofar) => {
          if (c === chain.length) {
            considered++;
            const option = evaluateCandidate(prepared, route, mat, sofar);
            if (option) options.push(option);
            return;
          }
          for (const where of placementsFor(chain[c], route, after)) {
            walk(c + 1, where.pos, [...sofar, where]);
          }
        };
        walk(0, -Infinity, []);
      }

      // What the plan itself is bought on: the money the road costs,
      // with the shorter day breaking the ties. A trip of its own is
      // ranked no differently — it is simply an expensive detour, which
      // is exactly what it is.
      options.sort((a, b) => a.extraMoney - b.extraMoney ||
                             a.extraDuration - b.extraDuration ||
                             a.name.localeCompare(b.name));

      // One option per truck: the second-best way of fitting the job
      // into the same route is not a second option to a planner, it is
      // the same phone call.
      const best = [];
      const seen = new Set();
      for (const o of options) {
        const key = `${o.spare ? `spare ${o.name}` : o.vehicle}|${o.shift.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (best.length < (wanted || OPTIONS)) best.push(o);
      }
      return { options: best, fitting: seen.size, considered, all: options.length };
    }

    return { prepare, evaluate, chainOf, keyOf, OPTIONS };
  }

  return { create, OPTIONS };
});
