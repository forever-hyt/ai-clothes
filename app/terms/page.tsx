import Link from 'next/link';
export default function Terms() {
  return <main><h1>服务条款（演示版）</h1><p>当前仅验证上传和预览流程，不提供真实 AI 换装或付费服务。</p><p>仅上传本人或已获授权的照片，不得上传侵权、违法或用于骚扰他人的内容。</p><p>提交需登录授权账号并同意隐私说明。每个进程每分钟最多处理 5 次，每个 UTC 日期最多演示 20 次；重启会重置统计。暂不提供会员、积分、订单和注册。</p><p>本站不自行收集银行卡或 CVV。接入支付及真实 AI 前会更新说明。</p><Link href="/privacy">隐私说明</Link><p><Link href="/">返回工作台</Link></p></main>;
}
