// 内置示例插画(纯字符串,客户端与服务器共用)。
// 这些插画是站方自带素材,不涉及任何用户照片;服务器演示任务只合成这些内容。
export const personSvgBody = '<rect width="600" height="800" fill="#e8eee2"/><circle cx="300" cy="205" r="76" fill="#d9b89b"/><path d="M223 184q-10-105 80-99 91 0 80 109l-26-44-110 0z" fill="#354735"/><path d="M198 314q102-50 204 0l63 237-78 20-28-135v250H239V436l-26 135-78-20z" fill="#f2ede2"/><path d="M239 580h120v176h-50V634h-18v122h-52z" fill="#5f705b"/>';
export const clothingSvgBody = '<rect width="600" height="800" fill="#f6f0e3"/><path d="m213 188-128 80 68 119 64-41v288h166V346l64 41 68-119-128-80q-87 85-174 0z" fill="#708560" stroke="#4b6343" stroke-width="8"/><path d="M257 201q43 42 86 0" fill="none" stroke="#d9e2c8" stroke-width="12"/><path d="M218 583h162" stroke="#b7c6a1" stroke-width="5"/>';
export function svgDataUrl(body: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">${body}</svg>`)}`;
}
