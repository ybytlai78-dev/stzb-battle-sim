# Task 5 fix review package（工作区；无 commit）

Controller 已对照磁盘 UTF-8 原文（git diff 在 Windows 上会把 listing.ts 显示成乱码，以本文件为准）。

## `src/data/listing.ts` 新增一行（`OFFLINE_MAIN_SKILLS`）

```
  biyue: '防御 -29 成长未确认',
  shangshun_fani: '恢复 65% / 策略反击 180% 成长未确认（取基值）',
};
```

## `tests/heroes_panel_q7.test.ts`（未跟踪文件，整文件属于七将入库；本修复只改贾充相关）

文件头：

```
 * 贾充已挂主战法赏顺伐逆，因取基值进 OFFLINE 仍下架；
```

describe 标题：`七将面板入库（空槽 / 取基值下架）`

贾充用例：

```
  it('贾充 h708 晋步面板对齐 extra，赏顺伐逆已挂槽因取基值仍下架', () => {
    ...
    expect(rec.mainSkillId).toBe('shangshun_fani');
    expect(rec.mainSkillName).toBe('赏顺伐逆');
    expect(isHeroListed(rec)).toBe(false);
  });
```

面板四维断言未改。
