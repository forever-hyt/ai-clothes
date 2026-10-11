// 演示生成提供方:真实 AI 换装与内容审核服务尚未接入。
//
// AiProvider 是未来真实服务的接入点:接入时必须先完成输入与输出内容审核,
// 未审核内容一律拒绝输出(fail closed)。当前实现只用内置插画合成一张带
// "SIMULATION"水印的 SVG 搭配板,绝不处理用户上传图片,结果明确标注
// "非 AI 换装结果"。演示定价为固定常量,与界面文案一致。

import { personSvgBody, clothingSvgBody } from '../sample-art';
// 定价常量放在 app/pricing.ts（客户端+服务端共享），这里重导出保持原有引用不变。
export { QUALITY_COST, QUALITIES } from '../pricing';
import type { Quality } from '../pricing';
export type { Quality };

export type ProviderResult =
  | { ok: true; svg: string }
  | { ok: false; code: 'SIMULATED_PROVIDER_ERROR' | 'PROVIDER_ERROR'; message: string };

export type ProviderInput = { quality: Quality; simulateFailure: boolean };

export interface AiProvider {
  run(input: ProviderInput): Promise<ProviderResult>;
}

// 用内置插画合成演示搭配板(SVG,浏览器渲染,无服务器字体依赖)。
export function buildDemoBoard(quality: Quality, stamp: string): string {
  const tier = quality === 'hd' ? 'HD DEMO' : 'STANDARD DEMO';
  const hdFrame = quality === 'hd' ? '<rect x="29" y="104" width="1342" height="842" fill="none" stroke="#9db08f" stroke-width="3" stroke-dasharray="14 10"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1050" viewBox="0 0 1400 1050">
<rect width="1400" height="1050" fill="#f5f6ef"/>
<text x="55" y="80" font-family="sans-serif" font-size="38" font-weight="600" fill="#244e3d">STYLE MUSE / DEMO BOARD</text>
${hdFrame}
<rect x="45" y="120" width="810" height="810" fill="#ffffff"/>
<rect x="885" y="120" width="470" height="810" fill="#ffffff"/>
<svg x="65" y="140" width="770" height="770" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid meet">${personSvgBody}</svg>
<svg x="905" y="140" width="430" height="770" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid meet">${clothingSvgBody}</svg>
<text x="55" y="980" font-family="sans-serif" font-size="24" fill="#53634e">01 / PORTRAIT</text>
<text x="895" y="980" font-family="sans-serif" font-size="24" fill="#53634e">02 / CLOTHING</text>
<g transform="rotate(-16 700 525)">
  <rect x="150" y="504" width="1100" height="42" fill="#244e3d" opacity="0.88"/>
  <text x="700" y="533" text-anchor="middle" font-family="sans-serif" font-size="23" letter-spacing="2" fill="#e2edbe">SIMULATION · DEMO BOARD · NOT AN AI TRY-ON RESULT</text>
</g>
<text x="1345" y="1020" text-anchor="end" font-family="sans-serif" font-size="16" fill="#75837b">${tier} · ${stamp}</text>
</svg>`;
}

export const demoProvider: AiProvider = {
  async run(input) {
    if (input.simulateFailure) {
      return { ok: false, code: 'SIMULATED_PROVIDER_ERROR', message: '演示模式:按请求模拟了生成失败。' };
    }
    // 真实服务接入前,任何真实图片生成都必须在此拒绝(fail closed)。
    // 演示任务只合成内置插画,不处理任何上传内容。
    return { ok: true, svg: buildDemoBoard(input.quality, new Date().toISOString()) };
  },
};
