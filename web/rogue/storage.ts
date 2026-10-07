import type { StorageLike } from '../../src/rogue/save';

/**
 * 浏览器存储到玩法层接口的适配。逻辑代码不直接调用它。
 */
export function browserStorage(): StorageLike {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
}
