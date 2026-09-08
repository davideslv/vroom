// What the machines behind the planner say, said in Portuguese.
//
// Three of them answer this page and none of them speaks the planner's
// language: VROOM raises its exceptions in English (src/utils/exception.h,
// error codes 1 internal, 2 input, 3 routing), vroom-express wraps them
// and adds a few of its own, and OSRM answers with a code and a message
// of its own again. Their text goes straight into the status line and
// into the boxes under the tabs, so without this the one moment the
// planner most needs to read — the moment something went wrong — would
// be the one moment the screen turned English.
//
// Nothing is translated by guesswork: PATTERNS below is the list of the
// messages those three actually produce, each a regular expression over
// the English with the parts worth keeping (a location, a vehicle, a
// host and port) captured and put back. Anything not on the list is
// passed through unchanged rather than mangled, which is also what
// makes this safe to leave behind when the backends change: a new
// message reads in English, it does not disappear.
//
// Loaded by index.html before the model, and used wherever an answer
// from /api, /osrm/... or frontend/server.js is turned into something
// the planner reads.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BackendMessages = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // [regular expression over the English, Portuguese with $1, $2, ...]
  //
  // A third element names the capture group that is itself a backend
  // message rather than a value: the wrapping messages ("Unknown
  // internal error: <the real one>") carry another one inside them, and
  // it is translated in its turn.
  //
  // Ordered: the first match wins, so the specific messages come before
  // the general ones they would otherwise be swallowed by.
  const PATTERNS = [
    // ---------- VROOM, routing (code 3) ----------
    // By far the most common of them all: a point dropped in the sea,
    // in a field, or outside the map that was loaded.
    // VROOM names the point by its coordinates, written [longitude,
    // latitude] as every location in a request is. The planner types
    // and reads latitude first, so they are handed back that way round.
    [/^Could not find route near location \[(-?[\d.]+),\s*(-?[\d.]+)\]\.?$/i,
      "Não há estrada perto do ponto $2, $1: fica longe de mais de qualquer via, ou fora da área carregada (Portugal)."],
    [/^Could not find route near location (\d+)\.?$/i,
      "Não há estrada perto do ponto $1: fica longe de mais de qualquer via, ou fora da área carregada (Portugal)."],
    [/^Failed to connect to (.+?):(\d+)\.?$/i,
      "O otimizador não conseguiu contactar o servidor de encaminhamento em $1:$2. O contentor OSRM está a correr?"],
    [/^Invalid profile: (.+?)\.?$/i,
      "Perfil de encaminhamento inválido: $1. Confirme que está declarado em vroom-conf/config.yml e em docs/no_go_zones.json."],
    [/^Failed to parse routing response\.?$/i,
      "Não foi possível interpretar a resposta do servidor de encaminhamento."],
    [/^Invalid routing response: (.+)$/i,
      "Resposta inválida do servidor de encaminhamento: $1", 1],
    [/^Route geometry request with missing coordinates\.?$/i,
      "Pedido do traçado da rota sem coordenadas."],
    [/^Missing coordinates for routing engine\.?$/i,
      "Faltam coordenadas para o servidor de encaminhamento."],
    [/^Empty (durations|distances|costs) matrix for (.+?) profile\.?$/i,
      "O servidor de encaminhamento devolveu uma matriz vazia para o perfil $2."],
    [/^Missing distances matrix for (.+?) profile\.?$/i,
      "Falta a matriz de distâncias do perfil $1."],
    [/^VROOM compiled without (?:routing support|libosrm installed)\.?$/i,
      "O otimizador foi compilado sem suporte de encaminhamento."],
    [/^VROOM compiled without libglpk installed\.?$/i,
      "O otimizador foi compilado sem a libglpk."],

    // ---------- VROOM, input (code 2) ----------
    // These say the request was built wrong, which in this planner is a
    // bug rather than something the office typed. They are translated
    // all the same: an unreadable error helps nobody report it.
    [/^No vehicle defined\.?$/i,
      "Nenhum veículo definido: a frota está vazia."],
    [/^No task defined\.?$/i,
      "Nenhuma tarefa definida: o dia não tem operações."],
    [/^Infeasible route for vehicle (\d+)\.?$/i,
      "A rota imposta ao veículo $1 é impossível."],
    [/^Invalid priority value\.?$/i,
      "Valor de prioridade inválido: um inteiro de 0 a 100."],
    [/^Invalid time[- ]window\.?$/i,
      "Janela temporal inválida."],
    [/^Invalid location for (.+?) (\d+)\.?$/i,
      "Localização inválida em $1 $2."],
    [/^Duplicate (job|pickup|break|task group) id: (.+?)\.?$/i,
      "Identificador repetido ($1): $2."],
    [/^Invalid (jobs|shipments|vehicles|vehicle_groups|task_groups)\.?$/i,
      "Bloco $1 inválido no pedido."],
    [/^Input root is not an object\.?$/i,
      "O pedido enviado ao otimizador não é um objeto JSON."],
    [/^Missing (pickup|delivery) for shipment\.?$/i,
      "Falta a $1 de um shipment."],
    [/^Invalid per_km cost for vehicle (\d+)\.?$/i,
      "Custo por quilómetro inválido no veículo $1."],
    [/^Invalid fixed cost for vehicle (\d+)\.?$/i,
      "Custo fixo inválido no veículo $1."],
    [/^Unknown group (.+?) for vehicle (.+?)\.?$/i,
      "Grupo desconhecido ($1) no veículo $2."],
    [/^Can't (read file|write to file): (.+)$/i,
      "O otimizador não conseguiu aceder ao ficheiro: $2"],

    // ---------- vroom-express ----------
    [/^Invalid JSON object in request.*$/i,
      "Pedido inválido: falta a lista de veículos, ou a de trabalhos e transportes."],
    [/^Too many locations \((\d+)\) in query, maximum is set to (\d+)$/i,
      "Pontos a mais no pedido ($1); o máximo do servidor é $2. Reduza o dia ou levante o limite em vroom-conf/config.yml."],
    [/^Too many vehicles \((\d+)\) in query, maximum is set to (\d+)$/i,
      "Veículos a mais no pedido ($1); o máximo do servidor é $2. Reduza a frota ou levante o limite em vroom-conf/config.yml."],
    [/^Unknown internal error(?::\s*(.*))?$/i,
      "Erro interno desconhecido no otimizador. $1", 1],
    [/^Internal error\.?$/i,
      "Erro interno do otimizador."],
    [/^(?:vroom was )?killed(?: by| with)? signal (.+?)\.?$/i,
      "O otimizador foi terminado pelo sinal $1 antes de acabar."],

    // ---------- OSRM's own prose, which VROOM re-throws verbatim ----------
    [/^Could not find a matching segment for coordinate (\d+)\.?$/i,
      "O ponto $1 não tem estrada perto: fica longe de mais de qualquer via."],
    [/^(?:Impossible|No) route (?:found )?between points\.?$/i,
      "Não há caminho por estrada entre estes pontos."],
    [/^Too big\. Number of entries (\d+) exceeds max.*$/i,
      "Pontos a mais para o servidor de encaminhamento de uma só vez ($1)."],
    [/^Coordinate is invalid.*$/i,
      "Coordenada inválida no pedido ao servidor de encaminhamento."],
    [/^URL string malformed close to position (\d+)\.?$/i,
      "O pedido ao servidor de encaminhamento está mal formado (posição $1); o nome do perfil só pode ter letras."],

    // ---------- OSRM codes, as the Extra job tab asks it directly ----------
    [/^NoRoute$/,
      "Não há caminho por estrada entre estes pontos."],
    [/^NoSegment$/,
      "Um dos pontos não tem estrada perto: fica longe de mais de qualquer via."],
    [/^NoTable$/,
      "O servidor de encaminhamento não conseguiu calcular os tempos de viagem."],
    [/^(?:InvalidUrl|InvalidQuery|InvalidService|InvalidVersion|InvalidOptions|InvalidValue)$/,
      "Pedido inválido ao servidor de encaminhamento."],
    [/^TooBig$/,
      "Pontos a mais para o servidor de encaminhamento de uma só vez."],
    [/^NotImplemented$/,
      "O servidor de encaminhamento não suporta este pedido."],

    // ---------- the network under all of them ----------
    [/^(?:connect )?ECONNREFUSED(.*)$/,
      "Ligação recusada$1: nada responde nesse endereço."],
    [/^(?:connect )?(?:ETIMEDOUT|ESOCKETTIMEDOUT)(.*)$/,
      "A ligação expirou$1."],
    [/^(?:getaddrinfo )?(?:ENOTFOUND|EAI_AGAIN)(.*)$/,
      "Endereço não encontrado$1."],
    [/^ECONNRESET(.*)$/,
      "A ligação foi cortada$1."],
    [/^Failed to fetch$/i,
      "Não foi possível contactar o servidor."],
    [/^NetworkError.*$/i,
      "Erro de rede ao contactar o servidor."],
  ];

  // What an HTTP status means on its own, for an answer that carried no
  // message at all. Only the ones this planner can actually provoke.
  const STATUS = {
    400: "pedido inválido",
    403: "acesso proibido",
    404: "não encontrado",
    405: "método não permitido",
    409: "já está a decorrer",
    413: "pedido demasiado grande",
    500: "erro interno do servidor",
    502: "o servidor intermédio não obteve resposta",
    503: "serviço indisponível",
    504: "o servidor não respondeu a tempo",
  };

  // What VROOM's error codes mean, which is the one thing about a
  // solver failure that is always known even when the message is not.
  const CODES = {
    1: "erro interno do otimizador",
    2: "o pedido enviado ao otimizador é inválido",
    3: "erro de encaminhamento",
  };

  // One message, Portuguese if it is one of the known ones. A backend
  // often stacks two of them behind a colon ("Unknown internal error:
  // Could not find route near location 4"), so the tail is translated
  // too and the two are put back together.
  function translate(text) {
    const s = String(text == null ? "" : text).trim();
    if (!s) return "";
    for (const [pattern, replacement, nested] of PATTERNS) {
      const m = pattern.exec(s);
      if (!m) continue;
      const out = replacement.replace(/\$(\d)/g, (_, digit) => {
        const i = Number(digit);
        const value = m[i] == null ? "" : m[i];
        return i === nested ? translate(value) : value;
      });
      // A pattern whose capture was empty leaves a dangling "erro: " or
      // a double space behind it.
      return out.replace(/\s{2,}/g, " ").replace(/[:\s]+$/, "").trim();
    }
    const colon = s.indexOf(": ");
    if (colon > 0) {
      const tail = translate(s.slice(colon + 2));
      if (tail !== s.slice(colon + 2)) return `${s.slice(0, colon)}: ${tail}`;
    }
    return s;
  }

  // The text of anything that can be thrown, translated. `Error`
  // carries its message, a fetch rejection carries a code, and a
  // backend body carries `error`.
  function of(err) {
    if (err == null) return "";
    if (typeof err === "string") return translate(err);
    return translate(err.error || err.message || String(err));
  }

  // A failed answer from the solver (/api, i.e. vroom-express and VROOM
  // behind it), as one line. `body` is the parsed JSON when there was
  // one, `raw` the text when there was not.
  function solver(status, body, raw) {
    const parts = [];
    const code = body && body.code;
    const message = of(body && body.error) || (raw ? translate(raw) : "");
    if (message) parts.push(message);
    else if (CODES[code]) parts.push(CODES[code]);
    else if (STATUS[status]) parts.push(STATUS[status]);
    else parts.push(`o otimizador respondeu ${status}`);
    // The code is worth carrying only when it says something the
    // message does not: which of the three kinds of failure it was.
    if (CODES[code] && message) parts.push(`(${CODES[code]})`);
    return parts.join(" ");
  }

  // A failed answer from OSRM, which the Extra job tab asks directly.
  // Its `code` is the machine-readable half and `message` the prose.
  function router(status, body) {
    const code = body && body.code && body.code !== "Ok" ? String(body.code) : "";
    const known = code ? translate(code) : "";
    // A code this file knows says the whole thing; OSRM's own prose
    // beside it is the same sentence in English, so it is dropped
    // rather than tacked on.
    if (known && known !== code) return known;
    const said = of(body && (body.message || body.error));
    if (code && said) return `${code}: ${said}`;
    return said || code || STATUS[status] || `o servidor de encaminhamento respondeu ${status}`;
  }

  // What an HTTP status means, for a place that has nothing else to go on.
  function status(code) {
    return STATUS[code] || `resposta ${code}`;
  }

  return { translate, of, solver, router, status };
});
