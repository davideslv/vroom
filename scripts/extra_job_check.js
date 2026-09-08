#!/usr/bin/env node
// Checks the arithmetic behind the Extra job tab: fitting one more job
// into a plan whose trucks are already out (frontend/public/waste_insert.js,
// described in docs/extra_job.md).
//
//     node scripts/extra_job_check.js
//
// Nothing here talks to a solver or to a routing server. The plan is
// crafted by hand and so is the travel-time table, which is what makes
// every number below one that can be worked out on paper: the new
// client sits two kilometres off the road between the two stops the
// truck is already making, and forty kilometres from the company. Every
// rule the tab enforces — the loading rules, the end of the shift, the
// caps, the freeze at the current time — is then a question of which
// options come back and at what price.
//
// Prints one line per check and exits non-zero if any of them fails.
const path = require("path");
const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "frontend/public/waste_model.js")).create(
  require(path.join(ROOT, "docs/waste_rules.json")),
  require(path.join(ROOT, "docs/waste_defaults.json")),
  require(path.join(ROOT, "docs/no_go_zones.json")));
const I = require(path.join(ROOT, "frontend/public/waste_insert.js")).create(M);

const COMPANY = { lat: 37.0, lng: -8.0 };
const P = { company: [-8.0, 37.0], A: [-7.9, 37.0], B: [-7.8, 37.0], NEW: [-7.85, 37.0] };
const NAME = {};
for (const [name, pt] of Object.entries(P)) NAME[I.keyOf(pt)] = name;

const one = (kind, n) => M.KINDS.map((k) => (k === kind ? n : 0));

// Minutes and kilometres between the four places. The new client sits
// right between the two the truck is already visiting and a long way
// from the company: slipping it in between them is by far the cheapest
// thing to do, and the only thing stopping it is that the truck is full
// there. So if the loading rules are ignored anywhere, the numbers say
// so loudly.
const ROAD = {
  "company|A": [600, 10000], "company|B": [900, 15000], "company|NEW": [1500, 40000],
  "A|B": [600, 10000], "A|NEW": [300, 6000], "B|NEW": [300, 6000],
};
function road(a, b) {
  if (a === b) return [0, 0];
  return ROAD[`${a}|${b}`] || ROAD[`${b}|${a}`];
}
function matrixOf(prepared, profile) {
  const points = prepared.points[profile];
  const names = points.map((p) => NAME[I.keyOf(p)]);
  return {
    durations: names.map((a) => names.map((b) => road(a, b)[0])),
    distances: names.map((a) => names.map((b) => road(a, b)[1])),
  };
}

const times = { ...M.defaultTimes(), dayStart: 8 * 3600, dayEnd: 17 * 3600,
                lunchStart: 12 * 3600, lunchEnd: 13 * 3600,
                clientService: 600, companySetup: 300, companyService: 300 };

// A multiban that goes out, picks up two full 6 m³ containers and
// brings them home. Between the two pickups it is at 2f6, which is the
// most it is allowed to carry.
function plan() {
  const step = (type, loc, arrival, load, extra = {}) => ({
    type, location: loc, arrival, load, setup: 0, service: 0, waiting_time: 0, ...extra,
  });
  return {
    routes: [{
      vehicle: 1,
      duration: 2100,
      distance: 35000,
      steps: [
        step("start", P.company, 8 * 3600, one("f6", 0)),
        step("pickup", P.A, 8 * 3600 + 600, one("f6", 1), { id: 11, service: 600, description: "op A: recolher cheio de 6 m³" }),
        step("pickup", P.B, 8 * 3600 + 1800, one("f6", 2), { id: 21, service: 600, description: "op B: recolher cheio de 6 m³" }),
        step("delivery", P.company, 8 * 3600 + 3300, one("f6", 1), { id: 12, setup: 300, service: 300, description: "op A: despejar cheio de 6 m³ na empresa" }),
        step("delivery", P.company, 8 * 3600 + 3900, one("f6", 0), { id: 22, service: 300, description: "op B: despejar cheio de 6 m³ na empresa" }),
        step("end", P.company, 8 * 3600 + 4200, one("f6", 0)),
      ],
    }],
  };
}

const vehicleInfo = { 1: { type: "multiban", chico: null, profile: "car", shift: "morning", early: 0 } };

function run(label, opts) {
  const prepared = I.prepare({
    solution: plan(), vehicleInfo, truckNames: { 1: "multiban 1" },
    op: opts.op, now: opts.now, depot: COMPANY, times,
    costs: M.defaultCosts(),
    limits: { ...M.defaultLimits(), ...(opts.limits || {}) },
    fleet: opts.fleet || { small: 0, multiban: 1, poliban: 0 },
    stock: opts.stock || {}, operations: opts.operations || [],
  });
  const matrices = {};
  for (const profile of Object.keys(prepared.points)) matrices[profile] = matrixOf(prepared, profile);
  const r = prepared.problems.length
    ? { options: [], all: 0, considered: 0, fitting: 0 }
    : I.evaluate(prepared, matrices, 50);
  const ok = opts.expect(r, prepared);
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  console.log(`        problems ${JSON.stringify(prepared.problems)} notes ${prepared.notes.length}`);
  console.log(`        ${r.all} fit of ${r.considered}, over ${r.fitting} trucks:`);
  for (const o of r.options.slice(0, 3)) {
    console.log(`          ${o.name}/${o.shift.key}${o.spare ? " (own trip)" : ""} ` +
      `+${o.extraDistance / 1000} km +${o.extraDuration / 60} min, ${o.delayed} later`);
  }
  if (!ok) process.exitCode = 1;
}

const pickup = { lat: 37.0, lng: -7.85, type: "pickup_full", size: 6 };
const deliver = { lat: 37.0, lng: -7.85, type: "deliver_empty", size: 6 };

// Between the two pickups the truck holds 2f6 and may hold no more, so
// the +2 km slot right there is not on offer: the cheapest thing left
// is to come back for it (company -> NEW -> company is 80 km, or the
// detour on the way home, A/B -> NEW -> company).
run("a third full 6 m³ may not go between the two pickups", {
  op: pickup, now: 8 * 3600,
  expect: (r) => {
    const own = r.options.filter((o) => !o.spare);
    return own.length > 0 && own.every((o) => o.extraDistance > 2000);
  },
});

// The very same job with the truck empty from the start: now the +2 km
// slot is there to be taken, which is what says the check above is
// about the load and not about the arithmetic.
run("with room on the truck the same job costs 2 km", {
  op: deliver, now: 8 * 3600,
  expect: (r) => r.options.length > 0 && r.options[0].extraDistance === 2000,
});

// The morning ends at 12:00 and nothing fits into its last ten minutes,
// so what is left is the afternoon.
run("at 11:50 only the afternoon is left", {
  op: pickup, now: 11 * 3600 + 3000,
  expect: (r) => r.options.length > 0 && r.options.every((o) => o.shift.key === "afternoon"),
});

// A cap the plan already sits at leaves no room for two more tasks.
run("max_tasks keeps the job out of the route", {
  op: pickup, now: 8 * 3600, limits: { maxTasks: 4 },
  expect: (r) => r.options.every((o) => o.spare),
});

// The truck's own route may not grow past a distance cap either.
run("max_distance keeps the job out of the route", {
  op: pickup, now: 8 * 3600, limits: { maxDistance: 36000 },
  expect: (r) => r.options.every((o) => o.spare),
});

// A second truck of the same type has not left the yard.
run("a truck still in the yard is offered a trip of its own", {
  op: pickup, now: 8 * 3600, fleet: { small: 0, multiban: 2, poliban: 0 },
  expect: (r) => r.options.some((o) => o.spare),
});

// At 08:25 the truck has left A (08:20) and is driving to B: that gap
// is behind it, so the job can only go in from B onwards, whatever it
// would have cost between the two.
run("a gap the truck is already driving is closed", {
  op: deliver, now: 8 * 3600 + 1500,
  expect: (r, p) => {
    const route = p.routes.find((x) => !x.spare);
    const own = r.options.filter((o) => !o.spare);
    return route && route.frozen === 2 && own.every((o) => {
      const line = o.timeline.findIndex((t) => t.kind === "new" && /entregar vazio/.test(t.text));
      const b = o.timeline.findIndex((t) => /op B: recolher cheio/.test(t.text));
      return line > b;
    });
  },
});

// An empty out of a yard that has none is a note, not a refusal: the
// planner standing in front of it knows better than this file does.
run("an empty yard is said and not enforced", {
  op: deliver, now: 8 * 3600, stock: { 6: 1 },
  operations: [{ id: 1, type: "exchange", size: 6 }],
  expect: (r, p) => p.notes.some((n) => /contentor/.test(n)) && r.options.length > 0,
});

console.log(process.exitCode ? "\nsomething is wrong" : "\nall checks passed");
