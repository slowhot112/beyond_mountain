import urllib.request, json

CASES = [
    {
        'tag': '案例1·AI算法',
        'topic': 'AI算法岗秋招卷不卷',
        'persona': {'stage':'explore','stageName':'在校探索','goals':['intern'],'goalNames':['找实习'],
                    'industry':'ai','industryName':'AI / 人工智能','sub':'算法','subName':'算法',
                    'city':'北京','timePressure':'3个月内','confusion':'AI算法岗秋招到底卷不卷，非科班转行有戏吗','education':'211本科计算机','prompt':'test'},
        'queries':['算法 找实习','算法 真实经历','算法 要不要','AI算法岗秋招卷不卷','算法 实习']
    },
    {
        'tag': '案例2·金融量化',
        'topic': '量化私募校招门槛',
        'persona': {'stage':'grad','stageName':'应届求职','goals':['fulltime'],'goalNames':['找全职'],
                    'industry':'finance','industryName':'金融','sub':'量化','subName':'量化',
                    'city':'上海','timePressure':'1个月内','confusion':'量化私募校招是不是只认清北复交，双非有机会吗','education':'双非金融硕士','prompt':'test'},
        'queries':['量化 找全职','量化 真实经历','量化 要不要','量化私募校招门槛','量化 实习']
    },
    {
        'tag': '案例3·传媒编导',
        'topic': '短视频编导要不要转行',
        'persona': {'stage':'watch','stageName':'在职观望','goals':['industry'],'goalNames':['换行业'],
                    'industry':'media','industryName':'传媒 / 内容','sub':'短视频编导','subName':'短视频编导',
                    'city':'杭州','timePressure':'三个月以上','confusion':'短视频编导要不要转行，行业是不是在收缩','education':'3年编导经验','prompt':'test'},
        'queries':['短视频编导 换行业','短视频编导 真实经历','短视频编导 要不要','短视频编导要不要转行','短视频编导 实习']
    },
    {
        'tag': '案例4·医疗药代',
        'topic': '医药代表出路',
        'persona': {'stage':'deepen','stageName':'在职深耕','goals':['company'],'goalNames':['换公司'],
                    'industry':'medical','industryName':'医疗 / 健康','sub':'医药代表','subName':'医药代表',
                    'city':'广州','timePressure':'一周内','confusion':'医药代表还值得做吗，集采后出路在哪','education':'本科药学','prompt':'test'},
        'queries':['医药代表 换公司','医药代表 真实经历','医药代表 要不要','医药代表出路','医药代表 实习']
    },
    {
        'tag': '案例5·体制内公务员',
        'topic': '公务员要不要辞职下海',
        'persona': {'stage':'offer','stageName':'Offer 决策','goals':['compare'],'goalNames':['比较 Offer'],
                    'industry':'civil','industryName':'体制内 / 国企','sub':'公务员','subName':'公务员',
                    'city':'成都','timePressure':'','confusion':'考上公务员但想辞职，要不要下海','education':'本科公共管理','prompt':'test'},
        'queries':['公务员 比较 Offer','公务员 真实经历','公务员 要不要','公务员要不要辞职下海','公务员 实习']
    },
]

for c in CASES:
    body = {'mode':'LIVE','topic':c['topic'],'persona':c['persona'],'queries':c['queries']}
    req = urllib.request.Request('http://127.0.0.1:3000/api/alchemy',
        data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=60)
        d = json.loads(r.read())
        data = d.get('data', {})
        roles = data.get('conflict',{}).get('roles',[])
        quiz = data.get('quiz',[])
        actions = data.get('actions',[])
        sources = data.get('sources',[])
        print('='*60)
        print(c['tag'])
        print('mock:', data.get('mock'), '| topic:', data.get('topic'))
        print('roles:', len(roles), [ (r.get('id'), r.get('name')) for r in roles])
        # 检查角色是否有真实区分
        stances = [r.get('stance','')[:20] for r in roles]
        print('stances:', stances)
        # 检查 matchReason 是否模板化
        mr = [r.get('matchReason','')[:25] for r in roles]
        print('matchReason:', mr)
        print('quiz 题数:', len(quiz), '| actions:', len(actions))
        print('action roles:', [a.get('role') for a in actions])
        print('sources 数:', len(sources))
        # 检查 actions 是否具体(含城市/时间)
        for a in actions[:1]:
            print('sample action:', a.get('task','')[:60])
    except Exception as e:
        print(c['tag'], 'ERROR', e)
