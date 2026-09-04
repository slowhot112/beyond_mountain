import urllib.request, json

body = {
    'mode': 'LIVE',
    'topic': 'frontend',
    'persona': {
        'stage': 'explore', 'stageName': '在校探索',
        'goals': ['intern'], 'goalNames': ['找实习'],
        'industry': 'it', 'industryName': 'IT / 互联网',
        'sub': '前端', 'subName': '前端',
        'city': '上海', 'timePressure': '3个月内',
        'confusion': '前端秋招卷不卷', 'education': '211本科', 'prompt': 'test'
    },
    'queries': ['前端 找实习', '前端 真实经历', '前端 要不要', '前端秋招卷不卷', '前端 实习']
}
req = urllib.request.Request(
    'http://127.0.0.1:3000/api/alchemy',
    data=json.dumps(body).encode(),
    headers={'Content-Type': 'application/json'}
)
r = urllib.request.urlopen(req)
d = json.loads(r.read())
print('ok:', d.get('ok'))
for a in d['data'].get('actions', []):
    print('role:', a.get('role'), '|', a['task'][:40])
