// Checkpoint assertions: `<subject> <operator> <value>`, one per line.
// The subject is a raw address (`$0048`) read with peek, or a path into the
// game's readable state (`party[0].hp`, `map`). The value is a JSON number,
// string, boolean or null, or a `$`/`0x` hex number.

export type ViewValue = number | string | boolean | null | ViewValue[] | { [key: string]: ViewValue };

export interface AssertionContext {
  peek(address: number): number;
  /** The game's readable state, or null when no memory map knows the game. */
  view: ViewValue | null;
}

const OPERATORS = ["==", "!=", ">=", "<=", ">", "<"] as const;
type Operator = (typeof OPERATORS)[number];

const ASSERTION = /^\s*(\S+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/;
const PATH_STEP = /^(?:\.?([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\])/;

export interface ParsedAssertion {
  subject: string;
  operator: Operator;
  expected: ViewValue;
}

function parseHex(text: string): number | null {
  const match = /^(?:\$|0x)([0-9a-fA-F]+)$/.exec(text);
  return match ? parseInt(match[1], 16) : null;
}

export function parseAssertion(line: string): ParsedAssertion {
  const match = ASSERTION.exec(line);
  if (!match) throw new Error(`"${line}" is not an assertion like \`party[0].hp >= 30\`.`);
  const [, subject, operator, valueText] = match;
  const hex = parseHex(valueText);
  if (hex !== null) return { subject, operator: operator as Operator, expected: hex };
  let expected: unknown;
  try {
    expected = JSON.parse(valueText);
  } catch {
    throw new Error(`"${line}": ${valueText} is not a number, a quoted string, true, false or null.`);
  }
  if (typeof expected === "object" && expected !== null) throw new Error(`"${line}": compare one value at a time, not a list or object.`);
  return { subject, operator: operator as Operator, expected: expected as ViewValue };
}

function readPath(view: ViewValue, path: string): ViewValue {
  let current: ViewValue = view;
  let rest = path;
  while (rest.length > 0) {
    const step = PATH_STEP.exec(rest);
    if (!step) throw new Error(`"${path}" is not a path like party[0].hp.`);
    const key = step[1] ?? Number(step[2]);
    const container: ViewValue = current;
    if (typeof key === "number" ? !Array.isArray(container) || key >= container.length : container === null || typeof container !== "object" || Array.isArray(container) || !(key in container)) {
      throw new Error(`"${path}": the game's state has no ${typeof key === "number" ? `[${key}]` : key} there.`);
    }
    current = (container as Record<string | number, ViewValue>)[key];
    rest = rest.slice(step[0].length);
  }
  return current;
}

export function readSubject(subject: string, context: AssertionContext): ViewValue {
  const address = parseHex(subject);
  if (address !== null) return context.peek(address);
  if (context.view === null) throw new Error(`"${subject}" needs a memory map for this game, and none knows it; use a raw address such as $0048.`);
  return readPath(context.view, subject);
}

function compare(actual: ViewValue, operator: Operator, expected: ViewValue): boolean {
  switch (operator) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    default:
      if (typeof actual !== "number" || typeof expected !== "number") return false;
      if (operator === ">=") return actual >= expected;
      if (operator === "<=") return actual <= expected;
      if (operator === ">") return actual > expected;
      return actual < expected;
  }
}

export interface AssertionResult {
  line: string;
  passed: boolean;
  actual: ViewValue | undefined;
  /** Set when the line could not be evaluated at all. */
  error?: string;
}

export function checkAssertion(line: string, context: AssertionContext): AssertionResult {
  try {
    const { subject, operator, expected } = parseAssertion(line);
    const actual = readSubject(subject, context);
    return { line, passed: compare(actual, operator, expected), actual };
  } catch (error) {
    return { line, passed: false, actual: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/** `path == value` for every leaf of a game's state: what a "Mark" records. */
export function assertionsFor(view: ViewValue, path = ""): string[] {
  if (Array.isArray(view)) return view.flatMap((item, index) => assertionsFor(item, `${path}[${index}]`));
  if (view !== null && typeof view === "object") {
    return Object.entries(view).flatMap(([key, value]) => assertionsFor(value, path ? `${path}.${key}` : key));
  }
  return [`${path} == ${JSON.stringify(view)}`];
}
