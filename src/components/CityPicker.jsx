import React, { useMemo, useState, useRef, useEffect } from 'react';
import { UNIQUE_CITIES } from '../lib.js';

// 常用城市拼音首字母（未命中则按首字兜底）
const CITY_INITIALS = {
  北京:'B',上海:'S',广州:'G',深圳:'S',杭州:'H',成都:'C',南京:'N',武汉:'W',西安:'X',苏州:'S',
  重庆:'C',天津:'T',长沙:'C',郑州:'Z',青岛:'Q',宁波:'N',东莞:'D',无锡:'W',佛山:'F',合肥:'H',
  厦门:'X',福州:'F',济南:'J',南昌:'N',昆明:'K',沈阳:'S',大连:'D',哈尔滨:'H',长春:'C',石家庄:'S',
  贵阳:'G',南宁:'N',海口:'H',兰州:'L',银川:'Y',西宁:'X',乌鲁木齐:'W',拉萨:'L',呼和浩特:'H',太原:'T',
  温州:'W',嘉兴:'J',绍兴:'S',金华:'J',台州:'T',常州:'C',南通:'N',徐州:'X',扬州:'Y',盐城:'Y',
  淮安:'H',镇江:'Z',泰州:'T',昆山:'K',张家港:'Z',常熟:'C',江阴:'J',宜兴:'Y',慈溪:'C',余姚:'Y',
  芜湖:'W',蚌埠:'B',阜阳:'F',六安:'L',安庆:'A',马鞍山:'M',宿州:'S',亳州:'B',宣城:'X',
  洛阳:'L',南阳:'N',新乡:'X',安阳:'A',焦作:'J',许昌:'X',平顶山:'P',信阳:'X',商丘:'S',周口:'Z',
  保定:'B',唐山:'T',廊坊:'L',沧州:'C',邯郸:'H',秦皇岛:'Q',邢台:'X',张家口:'Z',衡水:'H',承德:'C',
  烟台:'Y',潍坊:'W',临沂:'L',济宁:'J',淄博:'Z',威海:'W',泰安:'T',德州:'D',聊城:'L',菏泽:'H',
  珠海:'Z',汕头:'S',湛江:'Z',江门:'J',肇庆:'Z',茂名:'M',惠州:'H',梅州:'M',汕尾:'S',河源:'H',
  阳江:'Y',清远:'Q',中山:'Z',潮州:'C',揭阳:'J',云浮:'Y',
  泉州:'Q',漳州:'Z',莆田:'P',龙岩:'L',三明:'S',南平:'N',宁德:'N',
  湖州:'H',衢州:'Q',舟山:'Z',丽水:'L',
  淮南:'H',淮北:'H',铜陵:'T',黄山:'H',
  赣州:'G',九江:'J',宜春:'Y',上饶:'S',吉安:'J',抚州:'F',景德镇:'J',萍乡:'P',新余:'X',鹰潭:'Y',
  株洲:'Z',湘潭:'X',衡阳:'H',邵阳:'S',岳阳:'Y',常德:'C',张家界:'Z',益阳:'Y',郴州:'C',永州:'Y',怀化:'H',娄底:'L',湘西:'X',
  柳州:'L',桂林:'G',梧州:'W',北海:'B',防城港:'F',钦州:'Q',贵港:'G',玉林:'Y',百色:'B',贺州:'H',河池:'H',来宾:'L',崇左:'C',
  三亚:'S',三沙:'S',儋州:'D',
  遵义:'Z',六盘水:'L',安顺:'A',毕节:'B',铜仁:'T',黔东南:'Q',黔南:'Q',黔西南:'Q',
  自贡:'Z',攀枝花:'P',泸州:'L',德阳:'D',绵阳:'M',广元:'G',遂宁:'S',内江:'N',乐山:'L',南充:'N',眉山:'M',宜宾:'Y',广安:'G',达州:'D',雅安:'Y',巴中:'B',资阳:'Z',阿坝:'A',甘孜:'G',凉山:'L',
  曲靖:'Q',玉溪:'Y',保山:'B',昭通:'Z',丽江:'L',普洱:'P',临沧:'L',楚雄:'C',红河:'H',文山:'W',西双版纳:'X',大理:'D',德宏:'D',怒江:'N',迪庆:'D',
  宝鸡:'B',咸阳:'X',铜川:'T',渭南:'W',延安:'Y',汉中:'H',榆林:'Y',安康:'A',商洛:'S',
  嘉峪关:'J',金昌:'J',白银:'B',天水:'T',武威:'W',张掖:'Z',平凉:'P',酒泉:'J',庆阳:'Q',定西:'D',陇南:'L',临夏:'L',甘南:'G',
  海东:'H',海北:'H',黄南:'H',海南:'H',果洛:'G',玉树:'Y',海西:'H',
  石嘴山:'S',吴忠:'W',固原:'G',中卫:'Z',
  克拉玛依:'K',吐鲁番:'T',哈密:'H',昌吉:'C',博尔塔拉:'B',巴音郭楞:'B',阿克苏:'A',克孜勒苏:'K',喀什:'K',和田:'H',伊犁:'Y',塔城:'T',阿勒泰:'A',
  日喀则:'R',昌都:'C',林芝:'L',山南:'S',那曲:'N',阿里:'A',
  包头:'B',乌海:'W',赤峰:'C',通辽:'T',鄂尔多斯:'E',呼伦贝尔:'H',巴彦淖尔:'B',乌兰察布:'W',兴安:'X',锡林郭勒:'X',阿拉善:'A',
  鞍山:'A',抚顺:'F',本溪:'B',丹东:'D',锦州:'J',营口:'Y',阜新:'F',辽阳:'L',盘锦:'P',铁岭:'T',朝阳:'C',葫芦岛:'H',
  吉林:'J',四平:'S',辽源:'L',通化:'T',白山:'B',松原:'S',白城:'B',延边:'Y',
  齐齐哈尔:'Q',鸡西:'J',鹤岗:'H',双鸭山:'S',大庆:'D',伊春:'Y',佳木斯:'J',七台河:'Q',牡丹江:'M',黑河:'H',绥化:'S',大兴安岭:'D',
};

const RECOMMEND = [
  { title: '热门城市', cities: ['北京','上海','广州','深圳','杭州','成都'] },
  { title: '省会城市', cities: ['南京','武汉','西安','重庆','天津','长沙','郑州','青岛','宁波','厦门'] },
];

function initialOf(city) {
  return (CITY_INITIALS[city] || city[0] || '#').toUpperCase();
}

export default function CityPicker({ value, onChange, onClose }) {
  const [query, setQuery] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const scrollYRef = useRef(0);
  const closingRef = useRef(false);

  // 记录打开弹窗时的页面滚动位置；关闭时恢复，避免页面跳到底部
  useEffect(() => {
    scrollYRef.current = window.scrollY || document.documentElement.scrollTop || 0;
    return () => {
      window.scrollTo({ top: scrollYRef.current, behavior: 'instant' });
    };
  }, []);

  // 桌面端自动聚焦；移动端不聚焦，避免软键盘顶起弹窗导致点击错位
  useEffect(() => {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim();
    const list = q
      ? UNIQUE_CITIES.filter((c) => c.includes(q))
      : UNIQUE_CITIES;
    const map = {};
    list.forEach((city) => {
      const L = initialOf(city);
      if (!map[L]) map[L] = [];
      map[L].push(city);
    });
    return Object.keys(map).sort().reduce((acc, k) => { acc[k] = map[k]; return acc; }, {});
  }, [query]);

  const letters = useMemo(() => Object.keys(grouped), [grouped]);

  function scrollTo(letter) {
    const el = listRef.current?.querySelector(`[data-letter="${letter}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToTop() {
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  function select(city, e) {
    if (closingRef.current) return;
    closingRef.current = true;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    onChange(city);
    window.setTimeout(() => onClose(), 0);
  }

  // ESC 关闭
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="city-picker-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="city-picker">
        <div className="city-picker-head">
          <span>选择目标城市</span>
          <button type="button" className="city-picker-close" onClick={onClose}>✕</button>
        </div>
        <div className="city-picker-search">
          <input
            ref={inputRef}
            type="text"
            placeholder="搜索城市名"
            value={query}
            onChange={(e) => { setQuery(e.target.value); scrollToTop(); }}
          />
        </div>
        <div className="city-picker-body" ref={listRef}>
          {query.trim() ? (
            <div className="city-group search-results">
              <div className="city-group-title">搜索结果（{UNIQUE_CITIES.filter((c) => c.includes(query.trim())).length}）</div>
              <div className="city-grid compact">
                {UNIQUE_CITIES.filter((c) => c.includes(query.trim())).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`city-item${value === c ? ' on' : ''}`}
                    onMouseDown={(e) => select(c, e)}
                    onTouchStart={(e) => select(c, e)}
                    onClick={(e) => select(c, e)}
                  >{c}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {RECOMMEND.map((sec) => (
                <div className="city-group" key={sec.title}>
                  <div className="city-group-title">{sec.title}</div>
                  <div className="city-grid">
                    {sec.cities.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`city-item${value === c ? ' on' : ''}`}
                        onMouseDown={(e) => select(c, e)}
                        onTouchStart={(e) => select(c, e)}
                        onClick={(e) => select(c, e)}
                      >{c}</button>
                    ))}
                  </div>
                </div>
              ))}
              {letters.map((L) => (
                <div className="city-group" key={L} data-letter={L}>
                  <div className="city-group-title">{L}</div>
                  <div className="city-grid">
                    {grouped[L].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`city-item${value === c ? ' on' : ''}`}
                        onMouseDown={(e) => select(c, e)}
                        onTouchStart={(e) => select(c, e)}
                        onClick={(e) => select(c, e)}
                      >{c}</button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        {!query.trim() && (
          <div className="city-picker-index">
            {letters.map((L) => (
              <button key={L} type="button" onClick={() => scrollTo(L)}>{L}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
