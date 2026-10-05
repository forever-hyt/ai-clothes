/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import type { Language } from './studio-copy';
import type { Material } from './studio-images';

import { categories, clothes, seasons } from './clothing-catalog';

export default function ClothingLibrary({ open, language, disabled, selectedUrl, onSelect }: { open: boolean; language: Language; disabled: boolean; selectedUrl?: string; onSelect: (material: Material) => void }) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [season, setSeason] = useState('all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('explore');
  const [style, setStyle] = useState('all');
  const zh = language === 'zh';
  const label = (cn: string, en: string) => zh ? cn : en;
  const styles = [...new Map(clothes.map(item => [item.styleEn, item.styleZh])).entries()];
  const filteredItems = clothes.filter(item => (category === 'all' || item.category === category) && (season === 'all' || item.seasons.includes(season)) && (style === 'all' || item.styleEn === style) && `${item.zh} ${item.en} ${item.styleZh} ${item.styleEn}`.toLowerCase().includes(search.trim().toLowerCase()));
  const filtered = [...filteredItems].sort((a, b) => {
    if (sort === 'name') return (zh ? a.zh : a.en).localeCompare(zh ? b.zh : b.en, zh ? 'zh-CN' : 'en');
    const aCategory = categories.findIndex(row => row[0] === a.category);
    const bCategory = categories.findIndex(row => row[0] === b.category);
    if (sort === 'category') return aCategory - bCategory || Number(a.id) - Number(b.id);
    const aRank = clothes.filter(item => item.category === a.category).findIndex(item => item.id === a.id);
    const bRank = clothes.filter(item => item.category === b.category).findIndex(item => item.id === b.id);
    return aRank - bRank || aCategory - bCategory;
  });
  const selected = clothes.find(item => item.url === selectedUrl);
  const selectedCategory = categories.find(row => row[0] === category);
  const activeSeason = seasons.find(row => row[0] === season);
  const categoryIcons = ['♧', '◇', 'Ⅱ', '▱', '♙', '◈', '♢', '↟', '↗', '❀', '✧', '☾'];
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const reset = () => { setSearch(''); setCategory('all'); setSeason('all'); setStyle('all'); setPage(1); };
  return <section id="clothing-library" className="clothing-library" hidden={!open} aria-labelledby="wardrobe-heading">
    <div className="wardrobe-heading"><div><span className="tiny-label">THE WARDROBE</span><h3 id="wardrobe-heading">{label('每一种风格，都有你的衣服', 'Find a look that feels like you')}</h3></div><span>{clothes.length} {label('款服饰', 'styles')} · {categories.length} {label('种分类', 'categories')}</span></div>
    <p className="wardrobe-note">{label('精选常见流行款式，点击即可作为服装素材。图片为款式示意图，可上传实物照片替换。', 'Browse popular styles and select one for your board. Images are illustrations; upload a photo for an actual garment.')}</p>
    <div className="wardrobe-seasons" aria-label={label('按季节挑选', 'Shop by season')}><button type="button" aria-pressed={season === 'all'} onClick={() => { setSeason('all'); setPage(1); }}><span>✦</span><strong>{label('全部季节', 'All seasons')}</strong><small>{label('发现更多搭配', 'Explore every style')}</small></button>{seasons.map(([id, cn, en], index) => <button type="button" key={id} aria-pressed={season === id} onClick={() => { setSeason(id); setPage(1); }}><span>{['❀', '☀', '❧', '❄', '◎'][index]}</span><strong>{label(cn, en)}</strong><small>{label(['轻盈叠穿', '清爽透气', '温柔层次', '温暖舒适', '日常百搭'][index], ['Light layers', 'Cool & airy', 'Textured layers', 'Warm & cozy', 'Everyday staples'][index])}</small></button>)}</div>
    <div className="wardrobe-section-label"><strong>{label('服饰分类', 'Clothing categories')}</strong><span>{label('日常穿搭、运动户外、礼服与家居', 'Everyday, outdoors, occasions & home')}</span></div>
    <div className="wardrobe-categories" aria-label={label('服饰分类', 'Clothing categories')}><button type="button" aria-pressed={category === 'all'} onClick={() => { setCategory('all'); setPage(1); }}><span className="category-icon" aria-hidden="true">✦</span><strong>{label('全部服饰', 'All clothes')}</strong><span className="category-total">{clothes.length}</span></button>{categories.map(([id, cn, en], index) => <button type="button" key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setPage(1); }}><span className="category-icon" aria-hidden="true">{categoryIcons[index]}</span><strong>{label(cn, en)}</strong><span className="category-total">{clothes.filter(item => item.category === id).length}</span></button>)}</div>
    <div className="wardrobe-filter-panel"><div className="wardrobe-filters"><label><span>{label('找一件心仪的衣服', 'Find your next piece')}</span><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={label('搜索款式或风格，例如：衬衫、牛仔、中式', 'Search a style, e.g. denim, shirt, Chinese')} /></label><label><span>{label('穿搭风格', 'Style')}</span><select value={style} onChange={event => { setStyle(event.target.value); setPage(1); }}><option value="all">{label('全部风格', 'All styles')}</option>{styles.map(([en, cn]) => <option key={en} value={en}>{label(cn, en)}</option>)}</select></label><label><span>{label('排列方式', 'Sort by')}</span><select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="explore">{label('多种款式交错展示', 'Explore all categories')}</option><option value="category">{label('按服饰分类', 'Category')}</option><option value="name">{label('按服饰名称', 'Name')}</option></select></label></div><div className="wardrobe-quick"><span>{label('快速查找', 'Quick search')}</span>{[['衬衫', 'shirt'], ['牛仔', 'denim'], ['针织', 'knit'], ['连衣裙', 'dress'], ['运动', 'sport'], ['中式', 'Chinese']].map(([cn, en]) => <button type="button" key={en} onClick={() => { setSearch(label(cn, en)); setPage(1); }}>{label(cn, en)}</button>)}</div></div>
    {(category !== 'all' || season !== 'all' || style !== 'all' || search) && <div className="wardrobe-active" aria-label={label('当前筛选条件', 'Active filters')}>{selectedCategory && <button type="button" onClick={() => { setCategory('all'); setPage(1); }}>{label(selectedCategory[1], selectedCategory[2])} ×</button>}{activeSeason && <button type="button" onClick={() => { setSeason('all'); setPage(1); }}>{label(activeSeason[1], activeSeason[2])} ×</button>}{style !== 'all' && <button type="button" onClick={() => { setStyle('all'); setPage(1); }}>{label(styles.find(row => row[0] === style)![1], style)} ×</button>}{search && <button type="button" onClick={() => { setSearch(''); setPage(1); }}>{search} ×</button>}</div>}
    {selected && <div className="wardrobe-selected" role="status"><img src={selected.url} alt="" /><div><small>{label('当前已选服装', 'Selected garment')}</small><strong>{label(selected.zh, selected.en)}</strong></div><span>✓ {label('已加入搭配素材', 'Added to your board')}</span></div>}
    <div className="wardrobe-results"><p className="wardrobe-count" role="status">{label(`找到 ${filtered.length} 款服饰`, `${filtered.length} styles found`)}</p><button className="text-button" type="button" onClick={reset}>{label('重置筛选', 'Reset filters')}</button></div>
    <div className="wardrobe-grid">{visible.map(item => <button className="garment-card" type="button" disabled={disabled} aria-pressed={selectedUrl === item.url} key={item.id} onClick={() => onSelect({ url: item.url, name: label(item.zh, item.en), source: 'builtin' })}><span className="garment-category">{(() => { const row = categories.find(row => row[0] === item.category)!; return label(row[1], row[2]); })()}</span><img src={item.url} alt={label(item.zh, item.en)} loading="lazy" /><strong>{label(item.zh, item.en)}</strong><span>{label(item.styleZh, item.styleEn)} · {item.seasons.includes('year-round') ? label('四季', 'Year-round') : item.seasons.map(id => { const row = seasons.find(row => row[0] === id)!; return label(row[1], row[2]); }).join(' / ')}</span><small>{selectedUrl === item.url ? label('✓ 已选用', '✓ Selected') : label('选用这件 ＋', 'Use this item ＋')}</small></button>)}</div>
    {filtered.length > pageSize && <nav className="wardrobe-pagination" aria-label={label('服饰分页', 'Wardrobe pages')}><button type="button" className="secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{label('上一页', 'Previous')}</button><div className="wardrobe-page-numbers">{Array.from({ length: pages }, (_, index) => index + 1).filter(number => number === 1 || number === pages || Math.abs(number - currentPage) <= 1).map((number, index, numbers) => <span key={number}>{index > 0 && number - numbers[index - 1] > 1 && <span className="page-gap">…</span>}<button type="button" aria-label={label(`第 ${number} 页`, `Page ${number}`)} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button></span>)}</div><button type="button" className="secondary-button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>{label('下一页', 'Next')}</button></nav>}
    {!filtered.length && <div className="wardrobe-empty"><p>{label('暂时没有匹配的衣服，试试其他关键词或分类。', 'No matching styles. Try another search or category.')}</p><button type="button" className="secondary-button" onClick={reset}>{label('重置筛选', 'Reset filters')}</button></div>}
    <p className="wardrobe-note">{label('趋势参考：', 'Trend references: ')}<a href="https://www.vogue.com/article/how-to-style-wide-leg-jeans-street-style" target="_blank" rel="noreferrer">Vogue · {label('阔腿牛仔', 'Wide-leg denim')}</a> / <a href="https://www.vogue.com/article/pre-fall-2026-all-the-trends-that-matter" target="_blank" rel="noreferrer">Vogue · {label('季节趋势', 'Seasonal trends')}</a></p>
  </section>;
}
