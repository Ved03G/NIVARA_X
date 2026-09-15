import re

patterns = [
    ("OLD_REGEX", re.compile(r'(?<!\d)\d{4}[\s]?\d{4}[\s]?\d{4}(?!\d)')),
    ("NEW_REGEX", re.compile(r'(?<!\d)(?<!\d[\s\-])\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b(?![\s\-]\d)(?!\d)'))
]

test_string = """
ACCOUNT NUMBER
4839 2018 4719 0023
IFSC CODE
SBIN0001234
AADHAAR
1234 5678 9012
"""

for name, pattern in patterns:
    matches = pattern.findall(test_string)
    print(f"{name}: {matches}")
