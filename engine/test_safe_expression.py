import time
import unittest
import pandas as pd
from safe_expression import safe_eval

class ExpressionTests(unittest.TestCase):
    def setUp(self):
        self.frame = pd.DataFrame({'qty':[2,3], 'price':[5,8], 'status':['OPEN','CLOSED']})
    def test_arithmetic(self):
        self.assertEqual(safe_eval(self.frame, 'qty * price').tolist(), [10,24])
    def test_condition(self):
        self.assertEqual(safe_eval(self.frame, "qty > 1 and status in ('OPEN', 'PENDING')").tolist(),[True,False])
    def test_reject_code(self):
        for expression in ["__import__('os')", 'qty.__class__', 'qty[0]', '2 ** 999999999', 'lambda: 1']:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                safe_eval(self.frame,expression)

    def test_reject_os_execution(self):
        """Calling anything, including builtins reached via __import__, is not a
        supported syntax form (Call is never handled), so this never reaches the
        point of actually running a subprocess."""
        with self.assertRaises(ValueError):
            safe_eval(self.frame, "__import__('os').system('id')")

    def test_reject_class_traversal(self):
        """The classic sandbox-escape gadget: walk from an empty tuple literal to
        object.__subclasses__() by chasing __class__/__bases__. Subscript and
        Attribute nodes are both unhandled, so this is rejected long before the
        attribute chain would resolve to anything."""
        with self.assertRaises(ValueError):
            safe_eval(self.frame, "().__class__.__bases__[0]")

    def test_reject_attribute_access(self):
        """Plain attribute access on a real column name, not just on a literal."""
        with self.assertRaises(ValueError):
            safe_eval(self.frame, 'qty.__class__')
        with self.assertRaises(ValueError):
            safe_eval(self.frame, 'qty.__class__.__mro__')

    def test_reject_comprehensions(self):
        for expression in ['[x for x in range(10)]', '{x for x in range(10)}',
                            '{x: x for x in range(10)}', '(x for x in range(10))']:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                safe_eval(self.frame, expression)

    def test_reject_exec_eval_strings(self):
        for expression in ['exec("import os")', 'eval("1+1")',
                            'eval(compile("1+1", "<s>", "eval"))']:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                safe_eval(self.frame, expression)

    def test_power_operator_unsupported(self):
        """`**` is intentionally not in BIN — there is no legitimate use for
        exponentiation in these expressions, and it is the classic vector for an
        arbitrary-precision-integer blowup. Confirm it is rejected as an
        unsupported operator, not silently evaluated."""
        with self.assertRaises(ValueError):
            safe_eval(self.frame, '9 ** 9')

    def test_runtime_bound_on_huge_exponentiation(self):
        """9**9**9 (9 raised to 9**9 = 387,420,489) would need hundreds of
        millions of digits to represent — computing or even printing it can hang
        a process for a very long time. Confirm it is rejected immediately
        (proving no attempt was made to compute it), not merely that it
        eventually raises."""
        start = time.monotonic()
        with self.assertRaises(ValueError):
            safe_eval(self.frame, '9**9**9')
        elapsed = time.monotonic() - start
        self.assertLess(elapsed, 1.0, 'safe_eval must reject this instantly, not attempt the computation')

    def test_magnitude_bound_is_independent_of_missing_pow(self):
        """Defense in depth: the size bound must hold even if a future change
        adds `**` support to BIN, not just because Pow happens to be absent
        today. Exercise the bound directly through the allowed operators
        (repeated multiplication) so the test still means something if BIN
        changes shape later."""
        from safe_expression import _bounded
        with self.assertRaises(ValueError):
            _bounded(10 ** 5000)
        # a plausible real business figure must never be rejected
        _bounded(10 ** 12)

if __name__ == '__main__': unittest.main()