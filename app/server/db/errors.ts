// 数据库不可用错误：production 模式下任何 Supabase/PostgreSQL 故障（网络失败、
// 迁移未执行、表不存在、RPC 权限不足等）都包装成此错误；路由层捕获后返回
// 503 DB_UNAVAILABLE，绝不回退内存账本、绝不当作「未登录」。错误详情只记
// 服务端日志（不含任何密钥），不返回浏览器。
export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}
