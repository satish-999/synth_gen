"""Restricted vector arithmetic for model expressions; no Python execution."""
import ast
import operator

BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
       ast.BitAnd: operator.and_, ast.BitOr: operator.or_}
CMP = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
       ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}

# `**` is deliberately absent from BIN: unbounded exponentiation on Python's
# arbitrary-precision ints (e.g. 9**9**9) can exhaust memory/CPU well before
# any AST node-count limit kicks in. This check is a second, independent
# layer: it still applies if `**` (or any other magnitude-growing operator)
# is ever added to BIN by a future change, rather than relying solely on
# what today's operator table happens to omit.
MAX_INT_BITS = 4096  # ~1233 decimal digits; far beyond any real business figure

def _bounded(value):
    if isinstance(value, int) and not isinstance(value, bool) and value.bit_length() > MAX_INT_BITS:
        raise ValueError('Model expression result is too large to compute safely.')
    return value

def safe_eval(frame, expression, **_ignored):
    if not isinstance(expression, str) or len(expression) > 4000:
        raise ValueError('Model expression must be text of at most 4000 characters.')
    tree = ast.parse(expression, mode='eval')
    if sum(1 for _ in ast.walk(tree)) > 256:
        raise ValueError('Model expression is too complex.')

    def run(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool, type(None))):
            return node.value
        if isinstance(node, ast.Name):
            if node.id.startswith('__') or node.id not in frame.columns:
                raise ValueError(f'Unknown model column: {node.id}')
            return frame[node.id]
        if isinstance(node, (ast.List, ast.Tuple)):
            if not all(isinstance(item, ast.Constant) for item in node.elts):
                raise ValueError('Membership lists must contain constants.')
            return [run(item) for item in node.elts]
        if isinstance(node, ast.BinOp) and type(node.op) in BIN:
            left, right = run(node.left), run(node.right)
            if isinstance(left, str) or isinstance(right, str):
                raise ValueError('String arithmetic is unsupported.')
            return _bounded(BIN[type(node.op)](left, right))
        if isinstance(node, ast.UnaryOp):
            value = run(node.operand)
            if isinstance(node.op, ast.USub): return -value
            if isinstance(node.op, ast.UAdd): return +value
            if isinstance(node.op, (ast.Not, ast.Invert)):
                return ~value if hasattr(value, 'index') else not value
        if isinstance(node, ast.BoolOp):
            values = [run(value) for value in node.values]
            result = values[0]
            combine = operator.and_ if isinstance(node.op, ast.And) else operator.or_
            for value in values[1:]: result = combine(result, value)
            return result
        if isinstance(node, ast.Compare):
            left = run(node.left)
            result = None
            for operation, comparator in zip(node.ops, node.comparators):
                right = run(comparator)
                if type(operation) in CMP:
                    value = CMP[type(operation)](left, right)
                elif isinstance(operation, (ast.In, ast.NotIn)) and isinstance(right, list):
                    value = left.isin(right) if hasattr(left, 'isin') else left in right
                    if isinstance(operation, ast.NotIn): value = ~value if hasattr(value, 'index') else not value
                else: raise ValueError('Unsupported comparison in model expression.')
                result = value if result is None else result & value
                left = right
            return result
        raise ValueError(f'Unsupported expression syntax: {type(node).__name__}. Only column arithmetic, comparisons and boolean conditions are allowed.')
    return run(tree.body)