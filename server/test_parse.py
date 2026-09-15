from agent import parse_vlm_response

raw = '{"actions":[{"type":"TYPE","target":"el_0001","value_ref":"[PERSON_1]"},\\n  {"type":"TYPE","target":"el_0002","value_ref":"[PERSON_2]"},\\n  {"type":"TYPE","target":"el_0003","value_ref":"[EMAIL_1]"},\\n  {"type":"TYPE","target":"el_0004","value_ref":"[PHONE_1]"},\\n  {"type":"TYPE","target":"el_0007","value_ref":"[PA'

try:
    resp = parse_vlm_response(raw)
    print("Parsed actions:", len(resp.actions))
    print("Task complete:", resp.task_complete)
except Exception as e:
    print("Failed:", e)
