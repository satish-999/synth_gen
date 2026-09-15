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
if __name__ == '__main__': unittest.main()