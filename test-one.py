import urllib.request, json, time

CASE = {
    'mode':'LIVE','topic':'医药代表出路',
    'persona':{'stage':'deepen','stageName':'在职深耕','goals':['company'],'goalNames':['换公司'],
               'industry':'medical','industryName':'医疗 / 健康','sub':'医药代表','subName':'医药代表',
               'city':'广州','timePressure':'一周内','confusion':'医药代表还值得做吗，集采后出路在哪','education':'本科药学','prompt':'test'},
    'queries':['医药代表 换公司','医药代表 真实经历','医药代表 要不要','医药代表出路','医药代表 实习']
}

t0 = time.time()
try:
    req = urllib.request.Request('http://127.0.0.1:3000/api/alchemy',
        data=json.dumps(CASE).encode(), headers={'Content-Type':'application/json'})
    r = urllib.request.urlopen(req, timeout=70)
    d = json.loads(r.read())
    dt = time.time() - t0
    data = d.get('data', {})
    roles = data.get('conflict',{}).get('roles',[])
    print('OK 耗时 %.1fs mock=%s' % (dt, data.get('mock')))
    print('roles:', len(roles), [r.get('name','')[:25] for r in roles])
    print('actions:', len(data.get('actions',[])), 'sources:', len(data.get('sources',[])))
except Exception as e:
    dt = time.time() - t0
    print('ERROR 耗时 %.1fs:' % dt, e)
