/* Rill prototype: sample data, written before the markup.
   Truthful to the backend contracts: PremiseSchema / GenericWorldSchema + xuanhuan powerSystem /
   CharacterListSchema / RelationListSchema. Medium-length character count is 8 (genre-profile). */
window.RILL = (() => {
  const projects = [
    {
      id: 'prj_9f2c',
      title: '青川令',
      genre: '玄幻',
      length: '中篇',
      tone: '厚重',
      pov: '第三人称限知',
      mode: 'manual',
      stage: '人物',
      status: '待确认',
      updated: '今天 14:32',
      done: 2,
      total: 3,
    },
    {
      id: 'prj_41ab',
      title: '雾港来信',
      genre: '悬疑',
      length: '短篇',
      tone: '紧张',
      pov: '第一人称',
      mode: 'auto',
      stage: '种子',
      status: '生成中',
      updated: '2 分钟前',
      done: 0,
      total: 3,
    },
    {
      id: 'prj_77e0',
      title: '她的海',
      genre: '都市',
      length: '中篇',
      tone: '治愈',
      pov: '第三人称限知',
      mode: 'manual',
      stage: '人物',
      status: '失败',
      updated: '昨天 21:07',
      done: 1,
      total: 3,
    },
  ];

  const premise = {
    title: '青川令',
    logline: '守碑人少女为修复断裂的边境碑阵，被迫与碑中封印的古旧战魂同行北上。',
    theme: '记忆与代价——被记住的人才有名字。',
    coreConflict: '修复碑阵需要以战魂的记忆为薪，而每点燃一次，他就忘掉一段自己。',
    protagonist: {
      name: '沈青偃',
      identity: '守碑人',
      desire: '修复碑阵，让亡兄的名字重新刻上碑',
      flaw: '不敢承认哥哥的死与自己有关',
    },
    setting: {
      era: '大凛王朝末年',
      place: '北境青川关',
      socialBackground: '边军制与碑祀制并存：战死者名入碑、魂守关，碑即律法。',
    },
    hook: '第一面碑阵裂开时，飞出的不是魂火，是一封三十年前的家书。',
    taboos: ['不写失忆梗循环', '不给亡兄加戏复活', '避免苦情告白'],
  };

  const world = {
    summary:
      '大凛北境以碑阵锁魂御敌。碑是律法也是兵器：战死者的名字刻上碑，魂便被锁在碑中守关；碑阵一旦断裂，关外的旧敌魂火便会趁夜渗入。守碑司掌碑，边军掌关，南院掌碑阵的秘密——三方各怀心事。',
    rules: [
      { name: '碑祀之律', description: '战死者名入碑，魂守关；碑在名在，碑毁名消。' },
      { name: '魂薪之律', description: '碑以记忆为薪：燃一段记忆，换一阵效力，燃尽者只剩名字。' },
      { name: '北风之律', description: '入冬后碑阵效力衰减，最怕一场带雪的黑风。' },
    ],
    factions: [
      { name: '守碑司', nature: '掌碑的衙司', stance: '守着规矩，也靠着规矩吃饭' },
      { name: '北境边军', nature: '守关的军镇', stance: '信枪不信碑，只求儿郎活着回家' },
      { name: '南院', nature: '朝堂内廷', stance: '要碑阵的秘密只属于京城' },
    ],
    custom: {
      kind: '力量体系',
      key: 'powerSystem',
      note: '玄幻 · 类型自定义块，与通用骨架分别校验',
      tiers: [
        { name: '铭魂境', what: '辨魂、铭名，替将死之人把名字刻上碑' },
        { name: '刻名境', what: '以血养碑，短暂唤醒碑中魂火' },
        { name: '碑主境', what: '与碑同寿，成为阵眼；代价是逐步让出自己' },
      ],
      cost: '每进一步，都要拿自己的一段记忆换。',
    },
  };

  const characters = [
    {
      name: '沈青偃',
      role: '主角',
      identity: '守碑人',
      desire: '修复碑阵，让亡兄的名字重新刻上碑',
      flaw: '不敢承认哥哥的死与自己有关',
      personality: '沉静执拗，习惯把话咽回去',
      background: '青川关守碑司旁支孤女，自幼与兄长相依为命',
      abilities: '辨魂、铭名、以血养碑',
      arc: '从「求兄归」到「让兄安息」，学会做活人的碑',
    },
    {
      name: '裴烈',
      role: '配角',
      identity: '碑中古战魂、前北境都尉',
      desire: '打完那场没打完的仗',
      flaw: '记忆每燃一次就碎一块，怕忘了为何而战',
      personality: '粗粝爽利，嘴上不饶人，做事极靠得住',
      background: '三十年前碑阵初立时被封入第一面碑的边军将领',
      abilities: '魂体刀法（伤魂不伤身）、燃忆为薪',
      arc: '从「求战死」到「求被记住」，最终选择做碑而不是做刀',
    },
    {
      name: '沈青崖',
      role: '配角',
      identity: '沈青偃之兄，碑魂形态',
      desire: '护住妹妹和身后这座关',
      flaw: '早已不算活人，却不肯承认自己正在消散',
      personality: '温和犹疑，习惯把选择让给别人',
      background: '三年前碑阵夜役中战死，名入碑而魂未散',
      abilities: '碑阵共鸣（范围感知）、短暂凝形',
      arc: '接受「名字比魂长久」，教妹妹刻下自己的名',
    },
    {
      name: '顾之衡',
      role: '反派',
      identity: '南院掌印太监',
      desire: '让碑阵的秘密只属于朝堂',
      flaw: '从不信人，只信契约与把柄',
      personality: '圆滑谨慎，笑里藏刀',
      background: '南院出身，三十年前碑阵之役的见证者之一',
      abilities: '御碑（驱使隶役碑魂）、权衡制衡',
      arc: '发现秘密握在一个孤女手里时，选择了最坏的那步棋',
    },
    {
      name: '岑小满',
      role: '配角',
      identity: '青川关驿卒',
      desire: '攒够钱去南边看海',
      flaw: '怕关外的风，更怕关内的规矩',
      personality: '热情嘴碎，天不怕地怕就怕无聊',
      background: '关口长大的孤儿，被守碑司雇来跑腿',
      abilities: '认脸记名，把关外人都认了个遍',
      arc: '学会害怕之后，仍然选择跑腿',
    },
    {
      name: '芦娘',
      role: '配角',
      identity: '老碑中诞生的碑灵',
      desire: '守住碑阵最初的规矩',
      flaw: '不理解活人为何总在改规矩',
      personality: '天真残酷，是非观停留在碑立之初',
      background: '与第一面碑同时诞生的灵，三十年间看着规矩一条条变形',
      abilities: '唤碑（唤醒沉睡的碑魂）、读碑上名',
      arc: '明白「规矩是活人写的，也该由活人改」',
    },
    {
      name: '贺征战',
      role: '配角',
      identity: '北境边军校尉',
      desire: '让麾下儿郎活着回家',
      flaw: '不信碑，只信手里的枪',
      personality: '火爆直率，认死理',
      background: '裴烈旧部之后，边军如今的脊梁',
      abilities: '军阵、哨戒',
      arc: '在「拿魂补碑」的命令前抗命',
    },
    {
      name: '阿沅',
      role: '配角',
      identity: '守碑司学徒',
      desire: '成为合格的守碑人',
      flaw: '怕自己有一天也被刻上碑',
      personality: '敏学好问，心思细',
      background: '三年前那场夜役中失去全家的孤儿，被沈青崖救下',
      abilities: '初识铭魂，尚不能独立施为',
      arc: '从「怕碑」到「愿守碑」',
    },
  ];

  const relations = [
    { from: '沈青偃', to: '裴烈', type: '同行 · 契约', fromRole: '守碑人', toRole: '碑中战魂' },
    { from: '沈青偃', to: '沈青崖', type: '兄妹', fromRole: '守碑人', toRole: '碑魂' },
    { from: '顾之衡', to: '沈青偃', type: '追捕 · 利用', fromRole: '南院', toRole: '守碑人' },
    { from: '裴烈', to: '顾之衡', type: '旧怨 · 敌对', fromRole: '战魂', toRole: '南院' },
    { from: '贺征战', to: '裴烈', type: '旧部之后 · 敬', fromRole: '边军', toRole: '战魂' },
    { from: '阿沅', to: '沈青偃', type: '学徒 · 师', fromRole: '学徒', toRole: '守碑人' },
  ];

  const usage = {
    premise: { in: 1842, out: 1206 },
    world: { in: 2317, out: 3884 },
    characters: { in: 2905, out: 4512 },
  };

  // assertions: the data agrees with itself and with the contracts
  console.assert(characters.length === 8, '中篇人物数应为 8');
  console.assert(characters[0].role === '主角', '第一个人物必须是主角');
  const names = new Set(characters.map((c) => c.name));
  relations.forEach((r) => {
    console.assert(
      names.has(r.from) && names.has(r.to),
      `关系引用了不存在的人物: ${r.from}→${r.to}`,
    );
  });
  const pairs = new Set(relations.map((r) => `${r.from}->${r.to}`));
  console.assert(pairs.size === relations.length, '同一对人物只记一条关系');
  console.assert(new Set(characters.map((c) => c.name)).size === characters.length, '人物不重名');

  return { projects, premise, world, characters, relations, usage };
})();
