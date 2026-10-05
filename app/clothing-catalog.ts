export const categories = [['tops', '上衣', 'Tops'], ['outerwear', '外套', 'Outerwear'], ['pants', '裤装', 'Pants'], ['skirts', '裙装', 'Skirts'], ['dresses', '连衣裙', 'Dresses'], ['sets', '套装', 'Sets'], ['vests', '马甲背心', 'Vests'], ['jumpsuits', '连体服', 'Jumpsuits'], ['activewear', '运动户外', 'Activewear'], ['traditional', '中式服饰', 'Chinese styles'], ['occasion', '礼服派对', 'Occasionwear'], ['loungewear', '家居睡衣', 'Loungewear']] as const;
const rows = [
  ['tops', '宽松T恤', 'Oversized tee', '街头', 'Streetwear', 'summer'],
  ['tops', '条纹衬衫', 'Striped shirt', '通勤', 'Office', 'spring'],
  ['tops', '针织Polo衫', 'Knit polo', '学院', 'Preppy', 'spring'],
  ['tops', '短款背心', 'Cropped tank', '休闲', 'Casual', 'summer'],
  ['tops', '连帽卫衣', 'Hoodie', '街头', 'Streetwear', 'autumn'],
  ['tops', '半高领毛衣', 'Mock-neck sweater', '简约', 'Minimal', 'winter'],
  ['tops', '缎面衬衫', 'Satin shirt', '通勤', 'Office', 'spring'],
  ['tops', '针织开衫', 'Knit cardigan', '简约', 'Minimal', 'autumn'],
  ['outerwear', '经典风衣', 'Classic trench', '通勤', 'Office', 'autumn'],
  ['outerwear', '短款皮夹克', 'Cropped leather jacket', '街头', 'Streetwear', 'autumn'],
  ['outerwear', '牛仔夹克', 'Denim jacket', '休闲', 'Casual', 'spring'],
  ['outerwear', '宽松西装', 'Relaxed blazer', '通勤', 'Office', 'spring'],
  ['outerwear', '棒球夹克', 'Varsity jacket', '学院', 'Preppy', 'autumn'],
  ['outerwear', '羊毛大衣', 'Wool coat', '简约', 'Minimal', 'winter'],
  ['outerwear', '短款羽绒服', 'Cropped puffer', '休闲', 'Casual', 'winter'],
  ['outerwear', '户外冲锋衣', 'Shell jacket', '运动', 'Sport', 'autumn'],
  ['pants', '阔腿牛仔裤', 'Wide-leg jeans', '休闲', 'Casual', 'autumn'],
  ['pants', '直筒牛仔裤', 'Straight jeans', '简约', 'Minimal', 'spring'],
  ['pants', '弯刀牛仔裤', 'Barrel jeans', '街头', 'Streetwear', 'autumn'],
  ['pants', '高腰西装裤', 'Tailored trousers', '通勤', 'Office', 'spring'],
  ['pants', '工装裤', 'Cargo pants', '街头', 'Streetwear', 'autumn'],
  ['pants', '运动束脚裤', 'Joggers', '运动', 'Sport', 'spring'],
  ['pants', '亚麻短裤', 'Linen shorts', '度假', 'Vacation', 'summer'],
  ['pants', '骑行短裤', 'Cycling shorts', '运动', 'Sport', 'summer'],
  ['skirts', '百褶裙', 'Pleated skirt', '学院', 'Preppy', 'spring'],
  ['skirts', '缎面半身裙', 'Satin midi skirt', '简约', 'Minimal', 'summer'],
  ['skirts', '牛仔长裙', 'Denim maxi skirt', '休闲', 'Casual', 'autumn'],
  ['skirts', 'A字短裙', 'A-line mini skirt', '学院', 'Preppy', 'summer'],
  ['skirts', '通勤铅笔裙', 'Pencil skirt', '通勤', 'Office', 'spring'],
  ['skirts', '碎花半身裙', 'Floral skirt', '度假', 'Vacation', 'summer'],
  ['dresses', '碎花连衣裙', 'Floral dress', '度假', 'Vacation', 'summer'],
  ['dresses', '吊带长裙', 'Slip dress', '简约', 'Minimal', 'summer'],
  ['dresses', '衬衫连衣裙', 'Shirt dress', '通勤', 'Office', 'spring'],
  ['dresses', '针织连衣裙', 'Knit dress', '简约', 'Minimal', 'winter'],
  ['dresses', '小黑裙', 'Little black dress', '简约', 'Minimal', 'summer'],
  ['dresses', '泡泡袖连衣裙', 'Puff-sleeve dress', '度假', 'Vacation', 'summer'],
  ['sets', '西装套装', 'Tailored suit', '通勤', 'Office', 'autumn'],
  ['sets', '运动套装', 'Tracksuit', '运动', 'Sport', 'spring'],
  ['sets', '针织两件套', 'Knit co-ord', '简约', 'Minimal', 'autumn'],
  ['sets', '亚麻度假套装', 'Linen co-ord', '度假', 'Vacation', 'summer'],
  ['sets', '学院裙套装', 'Preppy skirt set', '学院', 'Preppy', 'spring'],
  ['sets', '牛仔套装', 'Denim co-ord', '街头', 'Streetwear', 'autumn'],
  ['tops', '亚麻衬衫', 'Linen shirt', '度假', 'Vacation', 'summer'],
  ['tops', '法式方领上衣', 'Square-neck blouse', '简约', 'Minimal', 'spring'],
  ['tops', '保暖高领针织衫', 'Turtleneck knit', '简约', 'Minimal', 'winter'],
  ['tops', '抓绒卫衣', 'Fleece sweatshirt', '运动', 'Sport', 'winter'],
  ['tops', '速干运动T恤', 'Performance tee', '运动', 'Sport', 'summer'],
  ['outerwear', '轻薄防晒衣', 'Sun-protection jacket', '运动', 'Sport', 'summer'],
  ['outerwear', '轻薄衬衫外套', 'Shirt jacket', '休闲', 'Casual', 'summer'],
  ['outerwear', '绗缝棉服', 'Quilted jacket', '休闲', 'Casual', 'winter'],
  ['outerwear', '长款羽绒服', 'Long puffer coat', '简约', 'Minimal', 'winter'],
  ['outerwear', '毛呢短外套', 'Cropped wool jacket', '学院', 'Preppy', 'winter'],
  ['pants', '灯芯绒直筒裤', 'Corduroy trousers', '学院', 'Preppy', 'winter'],
  ['pants', '加绒休闲裤', 'Fleece-lined trousers', '休闲', 'Casual', 'winter'],
  ['pants', '亚麻阔腿裤', 'Wide-leg linen pants', '度假', 'Vacation', 'summer'],
  ['pants', '百慕大短裤', 'Bermuda shorts', '简约', 'Minimal', 'summer'],
  ['pants', '微喇牛仔裤', 'Bootcut jeans', '街头', 'Streetwear', 'spring'],
  ['skirts', '毛呢格纹裙', 'Plaid wool skirt', '学院', 'Preppy', 'winter'],
  ['skirts', '针织半身裙', 'Knit midi skirt', '简约', 'Minimal', 'winter'],
  ['skirts', '灯芯绒A字裙', 'Corduroy A-line skirt', '休闲', 'Casual', 'autumn'],
  ['skirts', '轻盈纱裙', 'Tulle skirt', '度假', 'Vacation', 'spring'],
  ['skirts', '棉麻长裙', 'Linen maxi skirt', '度假', 'Vacation', 'summer'],
  ['dresses', '羊毛针织长裙', 'Wool knit maxi dress', '简约', 'Minimal', 'winter'],
  ['dresses', '长袖收腰连衣裙', 'Long-sleeve waist dress', '通勤', 'Office', 'autumn'],
  ['dresses', '棉麻度假裙', 'Linen vacation dress', '度假', 'Vacation', 'summer'],
  ['dresses', '背带连衣裙', 'Pinafore dress', '学院', 'Preppy', 'spring'],
  ['dresses', '丝绒长袖裙', 'Velvet dress', '简约', 'Minimal', 'winter'],
  ['sets', '保暖卫衣套装', 'Warm sweatshirt set', '休闲', 'Casual', 'winter'],
  ['sets', '毛呢裙套装', 'Wool skirt set', '通勤', 'Office', 'winter'],
  ['sets', '短袖短裤套装', 'Summer shorts set', '休闲', 'Casual', 'summer'],
  ['sets', '轻薄运动套装', 'Light sports set', '运动', 'Sport', 'summer'],
  ['sets', '春日衬衫套装', 'Spring shirt set', '通勤', 'Office', 'spring'],
  ['vests', '针织马甲', 'Knit vest', '学院', 'Preppy', 'spring'],
  ['vests', '西装马甲', 'Suit vest', '通勤', 'Office', 'autumn'],
  ['vests', '牛仔马甲', 'Denim vest', '街头', 'Streetwear', 'summer'],
  ['vests', '羽绒马甲', 'Puffer vest', '休闲', 'Casual', 'winter'],
  ['vests', '工装多口袋马甲', 'Utility vest', '街头', 'Streetwear', 'autumn'],
  ['vests', '棉麻背心', 'Linen vest', '度假', 'Vacation', 'summer'],
  ['vests', '羊绒背心', 'Cashmere vest', '简约', 'Minimal', 'winter'],
  ['vests', '短款绗缝马甲', 'Quilted vest', '休闲', 'Casual', 'spring'],
  ['jumpsuits', '牛仔连体裤', 'Denim jumpsuit', '街头', 'Streetwear', 'spring'],
  ['jumpsuits', '西装连体裤', 'Tailored jumpsuit', '通勤', 'Office', 'autumn'],
  ['jumpsuits', '亚麻连体短裤', 'Linen playsuit', '度假', 'Vacation', 'summer'],
  ['jumpsuits', '工装连体裤', 'Utility jumpsuit', '街头', 'Streetwear', 'autumn'],
  ['jumpsuits', '针织连体裤', 'Knit jumpsuit', '简约', 'Minimal', 'winter'],
  ['jumpsuits', '吊带阔腿连体裤', 'Strappy jumpsuit', '度假', 'Vacation', 'summer'],
  ['jumpsuits', '灯芯绒背带裤', 'Corduroy overalls', '学院', 'Preppy', 'winter'],
  ['jumpsuits', '棉质背带裤', 'Cotton overalls', '休闲', 'Casual', 'spring'],
  ['activewear', '瑜伽两件套', 'Yoga set', '运动', 'Sport', 'spring'],
  ['activewear', '速干跑步套装', 'Running set', '运动', 'Sport', 'summer'],
  ['activewear', '网球裙套装', 'Tennis skirt set', '运动', 'Sport', 'summer'],
  ['activewear', '骑行长袖套装', 'Cycling set', '运动', 'Sport', 'autumn'],
  ['activewear', '登山软壳外套', 'Hiking softshell', '运动', 'Sport', 'autumn'],
  ['activewear', '滑雪保暖套装', 'Ski suit', '运动', 'Sport', 'winter'],
  ['activewear', '抓绒户外套装', 'Outdoor fleece set', '运动', 'Sport', 'winter'],
  ['activewear', '轻薄徒步套装', 'Light hiking set', '运动', 'Sport', 'spring'],
  ['traditional', '立领盘扣衬衫', 'Mandarin-collar shirt', '中式', 'Chinese', 'spring'],
  ['traditional', '棉麻中式套装', 'Linen Chinese co-ord', '中式', 'Chinese', 'summer'],
  ['traditional', '改良旗袍', 'Modern qipao', '中式', 'Chinese', 'summer'],
  ['traditional', '马面裙', 'Mamian skirt', '中式', 'Chinese', 'autumn'],
  ['traditional', '交领汉服', 'Cross-collar hanfu', '中式', 'Chinese', 'spring'],
  ['traditional', '中式提花外套', 'Jacquard Chinese jacket', '中式', 'Chinese', 'autumn'],
  ['traditional', '夹棉唐装', 'Padded Tang jacket', '中式', 'Chinese', 'winter'],
  ['traditional', '绒面新中式长裙', 'Chinese velvet dress', '中式', 'Chinese', 'winter'],
  ['occasion', '缎面晚礼服', 'Satin evening gown', '礼服', 'Occasion', 'summer'],
  ['occasion', '露肩派对裙', 'Off-shoulder party dress', '礼服', 'Occasion', 'summer'],
  ['occasion', '亮片短礼服', 'Sequin mini dress', '礼服', 'Occasion', 'spring'],
  ['occasion', '长袖丝绒礼服', 'Long-sleeve velvet gown', '礼服', 'Occasion', 'winter'],
  ['occasion', '优雅燕尾礼服', 'Tailcoat suit', '礼服', 'Occasion', 'autumn'],
  ['occasion', '蕾丝长礼服', 'Lace gown', '礼服', 'Occasion', 'spring'],
  ['occasion', '披肩礼服套装', 'Cape gown set', '礼服', 'Occasion', 'winter'],
  ['occasion', '婚礼宾客连衣裙', 'Wedding guest dress', '礼服', 'Occasion', 'autumn'],
  ['loungewear', '棉质长袖睡衣', 'Cotton pajama set', '家居', 'Lounge', 'spring'],
  ['loungewear', '短袖短裤睡衣', 'Short pajama set', '家居', 'Lounge', 'summer'],
  ['loungewear', '缎面吊带睡裙', 'Satin nightdress', '家居', 'Lounge', 'summer'],
  ['loungewear', '针织家居套装', 'Knit lounge set', '家居', 'Lounge', 'autumn'],
  ['loungewear', '法兰绒睡衣', 'Flannel pajamas', '家居', 'Lounge', 'winter'],
  ['loungewear', '珊瑚绒连体睡衣', 'Fleece onesie', '家居', 'Lounge', 'winter'],
  ['loungewear', '棉质居家连衣裙', 'Cotton lounge dress', '家居', 'Lounge', 'spring'],
  ['loungewear', '长袖家居罩衫', 'Long lounge robe', '家居', 'Lounge', 'autumn'],
];
const colors = ['#7f9275', '#9daac0', '#c6a585', '#8b747b', '#536879', '#bcb397'];
function illustration(category: string, index: number, name: string) {
  const color = colors[index % colors.length];
  const shirt = '<path d="m90 65-48 30 20 43 30-18v100h96V120l30 18 20-43-48-30q-50 30-100 0z"/>';
  const pants = '<path d="M90 65h100l15 185h-50l-15-125-15 125H75z"/><path d="M92 84h96M140 85v40" fill="none"/>';
  const skirt = '<path d="M100 75h80l40 165H60z"/><path d="M103 88h74M110 98l-18 130m40-130-5 130m25-130 5 130m15-130 18 130" fill="none"/>';
  const dress = '<path d="m110 55-30 25 18 38 15-12-8 38-42 110h154l-42-110-8-38 15 12 18-38-30-25q-30 25-60 0z"/><path d="M105 144h70" fill="none"/>';
  const coat = '<path d="m104 50-42 25-28 120 35 8 25-88-12 140h116l-12-140 25 88 35-8-28-120-42-25-36 25z"/><path d="m104 50 36 60 36-60M140 110v145M97 162h86" fill="none"/>';
  const tank = '<path d="M106 60h16v25q18 16 36 0V60h16l14 150H92z"/>';
  const longSleeve = '<path d="m94 65-32 20-28 130 32 8 28-108v110h92V115l28 108 32-8-28-130-32-20q-46 24-92 0z"/>';
  const shorts = '<path d="M90 80h100l12 100h-53l-9-48-9 48H78z"/><path d="M93 95h94M140 95v37" fill="none"/>';
  const shortSkirt = '<path d="M100 90h80l32 100H68z"/><path d="M103 103h74" fill="none"/>';
  const slip = '<path d="M112 50h10v35q18 14 36 0V50h10l-4 94 43 110H73l43-110z"/>';
  const topShape = /背心|吊带/.test(name) ? tank : /毛衣|针织|卫衣|高领|抓绒/.test(name) ? longSleeve : shirt;
  const pantsShape = /短裤/.test(name) ? shorts : pants;
  const skirtShape = /短裙|格纹/.test(name) ? shortSkirt : skirt;
  const dressShape = /吊带/.test(name) ? slip : dress;
  const vest = '<path d="m106 65-20 18 13 43-7 97h96l-7-97 13-43-20-18-34 25z"/><path d="M140 90v130" fill="none"/>';
  const jumpsuit = '<path d="m107 50-26 20 12 55 10-8-8 25-20 115h51l14-88 14 88h51l-20-115-8-25 10 8 12-55-26-20q-33 25-66 0z"/><path d="M100 140h80" fill="none"/>';
  const chineseDress = '<path d="M113 48h54l12 18 26 27-16 28-15-18 20 158H86l20-158-15 18-16-28 26-27z"/><path d="M118 52v16h44V52m-20 16 23 36m-28-15h16m-8 14h16M173 217l9 44" fill="none"/>';
  const gown = '<path d="M107 60h12v28q21 20 42 0V60h12l-10 82 57 127H60l57-127z"/><path d="M117 142h46m-23 2-9 107" fill="none"/>';
  const traditionalShape = /裙/.test(name) ? (/马面/.test(name) ? skirt : chineseDress) : /汉服/.test(name) ? dress : /套装/.test(name) ? `<g transform="translate(40 5) scale(.72)">${longSleeve}</g><g transform="translate(40 130) scale(.72 .46)">${pants}</g>` : coat;
  const loungeShape = /睡裙|连衣裙/.test(name) ? slip : /连体/.test(name) ? jumpsuit : /罩衫/.test(name) ? coat : `<g transform="translate(40 5) scale(.72)">${topShape}</g><g transform="translate(40 130) scale(.72 .46)">${pantsShape}</g>`;
  const body = category === 'vests' ? vest : category === 'jumpsuits' ? jumpsuit : category === 'traditional' ? traditionalShape : category === 'occasion' ? (/燕尾/.test(name) ? coat : gown) : category === 'loungewear' ? loungeShape : category === 'activewear' ? (/外套/.test(name) ? coat : `<g transform="translate(40 5) scale(.72)">${topShape}</g><g transform="translate(40 130) scale(.72 .46)">${/网球/.test(name) ? shortSkirt : pantsShape}</g>`) : category === 'pants' ? pantsShape : category === 'skirts' ? skirtShape : category === 'dresses' ? dressShape : category === 'outerwear' ? coat : category === 'sets' ? `<g transform="translate(40 5) scale(.72)">${topShape}</g><g transform="translate(40 130) scale(.72 .46)">${pantsShape}</g>` : topShape;
  const detail = index === 1 ? '<path d="M106 103v100m16-100v100m16-100v100m16-100v100m16-100v100" stroke="#ffffff" opacity=".55"/>' : index === 2 ? '<path d="m115 75 25 20 25-20M140 95v25" fill="none" stroke="#fff"/>' : /羽绒|绗缝|棉服/.test(name) ? '<path d="M94 115h92m-92 27h92m-92 27h92m-92 27h92m-92 27h92" stroke="#ffffff" opacity=".5"/>' : /衬衫|开衫|西装/.test(name) ? '<path d="M140 88v130m-4-105h8m-8 22h8m-8 22h8m-8 22h8" stroke="#ffffff"/>' : /碎花/.test(name) ? '<g fill="#fff" opacity=".65"><circle cx="120" cy="170" r="5"/><circle cx="158" cy="196" r="5"/><circle cx="104" cy="223" r="5"/><circle cx="172" cy="230" r="5"/></g>' : '';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" data-style="${index}" width="280" height="320" viewBox="0 0 280 320"><rect width="280" height="320" rx="18" fill="#f3f1e9"/><ellipse cx="140" cy="282" rx="78" ry="8" fill="#e2dfd4"/><g fill="${color}" stroke="#435849" stroke-width="2.5" stroke-linejoin="round">${body}</g>${detail}</svg>`)}`;
}
function suitableSeasons(name: string, season: string) {
  if (/经典风衣|针织开衫|牛仔夹克|西装|连帽卫衣|工装裤|衬衫连衣裙|背带/.test(name)) return ['spring', 'autumn'];
  if (/直筒牛仔裤|阔腿牛仔裤|运动束脚裤/.test(name)) return ['spring', 'summer', 'autumn', 'winter', 'year-round'];
  if (/西装连体裤|针织马甲|牛仔马甲|交领汉服|立领盘扣/.test(name)) return ['spring', 'autumn'];
  return [season];
}
export const clothes = rows.map(([category, zh, en, styleZh, styleEn, season], index) => ({ id: String(index), category, zh, en, styleZh, styleEn, season, seasons: suitableSeasons(zh, season), url: illustration(category, index, zh) }));
export const seasons = [['spring', '春季', 'Spring'], ['summer', '夏季', 'Summer'], ['autumn', '秋季', 'Autumn'], ['winter', '冬季', 'Winter'], ['year-round', '四季', 'Year-round']];

