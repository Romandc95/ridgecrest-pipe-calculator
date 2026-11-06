// Expression evaluation with standard order of operations or chain (as-entered) mode.
import { Q, CalcError } from './units';
import { add, mul, div, powQ } from './arith';
import { FormatPrefs } from './format';

export type Op = '+' | '-' | '*' | '/' | '^' | 'root';
export type Tok = { t: 'v'; q: Q } | { t: 'op'; op: Op } | { t: '(' } | { t: ')' };

const PREC: Record<Op, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, root: 3 };
const RIGHT: Record<Op, boolean> = { '+': false, '-': false, '*': false, '/': false, '^': true, root: true };

export function applyOp(op: Op, a: Q, b: Q, prefs: FormatPrefs): Q {
  switch (op) {
    case '+': return add(a, b, 1, prefs);
    case '-': return add(a, b, -1, prefs);
    case '*': return mul(a, b, prefs);
    case '/': return div(a, b, prefs);
    case '^':
      if (b.kind !== 'num') throw new CalcError('DIM', 'The exponent must be a plain number.');
      return powQ(a, b.v, prefs);
    case 'root':
      if (b.kind !== 'num') throw new CalcError('DIM', 'The root index must be a plain number.');
      if (b.v === 0) throw new CalcError('MATH', 'Zeroth root is undefined.');
      return powQ(a, 1 / b.v, prefs);
  }
}

/** Evaluate a token list. In chain mode all binary operators have equal precedence (left to right). */
export function evaluate(tokens: Tok[], chain: boolean, prefs: FormatPrefs): Q {
  const out: Q[] = [];
  const ops: Array<Op | '('> = [];
  const prec = (o: Op) => (chain ? 1 : PREC[o]);
  const reduce = () => {
    const op = ops.pop() as Op;
    const b = out.pop(), a = out.pop();
    if (!a || !b) throw new CalcError('ENT', 'Incomplete expression.');
    out.push(applyOp(op, a, b, prefs));
  };
  let expectValue = true;
  for (const t of tokens) {
    if (t.t === 'v') {
      if (!expectValue) throw new CalcError('ENT', 'Two values in a row — an operator is missing.');
      out.push(t.q); expectValue = false;
    } else if (t.t === '(') {
      if (!expectValue) throw new CalcError('ENT', 'Put an operator before the parenthesis.');
      ops.push('(');
    } else if (t.t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') reduce();
      if (!ops.length) throw new CalcError('ENT', 'Unbalanced parenthesis.');
      ops.pop();
    } else {
      if (expectValue) throw new CalcError('ENT', 'Operator without a value before it.');
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(') break;
        if (prec(top) > prec(t.op) || (prec(top) === prec(t.op) && !(RIGHT[t.op] && !chain))) reduce();
        else break;
      }
      ops.push(t.op); expectValue = true;
    }
  }
  if (expectValue && tokens.length) throw new CalcError('ENT', 'Expression ends with an operator.');
  while (ops.length) { if (ops[ops.length - 1] === '(') ops.pop(); else reduce(); }
  if (out.length !== 1) throw new CalcError('ENT', 'Incomplete expression.');
  const r = out[0];
  if (!isFinite(r.v)) throw new CalcError('OFLO', 'Result is too large.');
  return r;
}
