import type { Language } from './studio-copy';

const legalSources = [
  ['《个人信息保护法》', 'Personal Information Protection Law', 'https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm'],
  ['《民法典》人格权编', 'Civil Code: personality rights', 'https://www.cac.gov.cn/2020-06/01/c_15925617772683193.htm'],
  ['《生成式人工智能服务管理暂行办法》', 'Interim measures for generative AI services', 'https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm'],
  ['《人工智能生成合成内容标识办法》', 'AI-generated content labeling measures', 'https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm'],
];
const sections = [
  ['允许与禁止的用途', 'Permitted and prohibited uses', '仅用于成年人普通服装搭配。禁止色情、裸露、脱衣、性化换脸、性骚扰、偷拍素材、未成年人照片及未经许可的肖像处理。人物必须保持完整衣着；不得通过空白服装请求脱衣。成年及授权声明不是自动年龄识别或权利核验。', 'Adult, non-sexual styling only. Pornography, nudity, undressing, sexualized face swaps, harassment, covert photos, images of minors and unauthorized portrait use are prohibited. Blank garments cannot request undressing. Adult and permission declarations are not automatic age or rights verification.'],
  ['空白拦截与审核边界', 'Blank checks and review limits', '缺少服装素材时停止运行；疑似纯色、全透明或近乎空白图片会被提示并拒绝。此检查不识别色情，也不保证图片中存在衣服，浅色低对比度照片可能需重新拍摄。自上传素材未审核，禁止生成与导出；服务器审核未配置时拒绝输出结果。', 'Missing garments stop processing. Uniform, fully transparent or near-blank images are rejected with a warning. This is not pornography detection or proof of a garment; low-contrast images may need retaking. Unreviewed uploads cannot generate or export, and the server returns no results without review.'],
  ['处理范围与撤回同意', 'Processing scope and withdrawal', '只处理本次选择的素材，不做人脸识别、身份匹配、模型训练或广告画像。人物照片可含个人信息，只有必要且取得适用授权时才能处理；本地授权与未来服务器上传授权分开。点击“撤回授权并清除图片”或退出账号，即清除当前素材和预览。', 'Only selected materials are processed. No face recognition, identity matching, model training or advertising profiles. Portrait processing requires necessity and applicable permission; local consent is separate from any future server consent. Withdraw consent or sign out to clear current materials and previews.'],
  ['第三方及真实换装开放条件', 'Third parties and enabling real try-on', '当前没有换装或内容审核服务商，不向第三方发送照片。真实换装开放前，必须说明运营方、服务商、处理目的、保留期限及必要的跨境安排，落实输入和输出审核。未来 AI 结果需落实适用的显式、隐式标识，不能用清除元数据移除应有的生成标识。', 'No try-on or review provider is connected and no photos are sent to third parties. Enabling try-on requires operator/provider disclosures, purposes, retention and any cross-border arrangements, plus input/output review. Future AI results must carry applicable visible and metadata labels; metadata cleanup must not erase required AI labels.'],
  ['隐私请求、投诉与举报', 'Privacy requests, complaints and reports', '可通过运营方联系方式提出查阅、复制、更正、删除、撤回同意或违法内容举报。请提供问题描述、发生时间和必要的页面信息，不要发送密码、身份证或色情原图。本站暂无投诉提交系统；未配置联系方式时只能进行受限演示，不应作为已具备完整投诉机制的公开服务。', 'Contact the operator for access, copies, correction, deletion, consent withdrawal or abuse reports. Provide a description, time and necessary page details, never passwords, identity documents or explicit original images. No complaint submission system exists yet; without contact details this remains a restricted demo.'],
];

export default function TrustPolicy({ language, contact }: { language: Language; contact: string }) {
  const zh = language === 'zh';
  return <div className="trust-policy">
    <div className="policy-grid">{sections.map(([cn, en, cnText, enText]) => <article key={en}><h2>{zh ? cn : en}</h2><p>{zh ? cnText : enText}</p></article>)}</div>
    <div className="policy-request"><h2>{zh ? '运营方联系与权利申请' : 'Operator contact and rights requests'}</h2><p>{contact || (zh ? '运营方身份与隐私联系渠道尚未配置，真实换装保持关闭。' : 'Operator details and a privacy contact are not configured. Real try-on remains disabled.')}</p></div>
    <h2>{zh ? '法律法规参考' : 'Legal references'}</h2><p>{zh ? '以下为中国大陆适用规则的官方参考。页面说明不是法律合规认证；实际适用范围取决于服务能力、使用地区及处理方式。' : 'Official references for mainland China. This page is not a compliance certification; applicability depends on capabilities, location and processing.'}</p>
    <ul className="legal-links">{legalSources.map(([cn, en, url]) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{zh ? cn : en} ↗</a></li>)}</ul>
  </div>;
}
