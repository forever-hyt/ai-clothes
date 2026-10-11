// 测试加载器辅助：源码按 TypeScript bundler 约定使用无扩展名相对导入（如 './sample-art'），
// 而 Node 的 require 不会为无扩展名说明符搜索 .ts；即使能加载 .ts，含 ESM 语法的文件
// 会被当作 ESM 处理，其内部无扩展名导入同样解析失败。
//
// 本模块在测试进程内做两件事（patchTsResolution()）：
// 1. 注册 Module._extensions['.ts']：所有 .ts 一律经 ts.transpileModule 转成 CJS 加载，
//    与 security.test.mjs 的既有加载方式一致，避免 ESM 解析路径；
// 2. 给 Module._resolveFilename 打补丁：相对导入解析失败时回退到显式 .ts 扩展名。
import Module from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';

const originalResolveFilename = Module._resolveFilename;
let patched = false;

export function patchTsResolution() {
  if (patched) return;
  patched = true;
  Module._extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    module._compile(compiled, filename);
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND' && typeof request === 'string' && /^\.\.?\//.test(request) && !/\.[a-z0-9]+$/i.test(request)) {
        return originalResolveFilename.call(this, `${request}.ts`, parent, isMain, options);
      }
      throw error;
    }
  };
}
