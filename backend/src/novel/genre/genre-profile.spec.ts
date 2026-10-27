import { Genre, StoryLength, worldSchemaFor } from '@rill/shared';
import { GENRE_PROFILES, profileFor, stagesFor } from './genre-profile.js';

describe('genre profile', () => {
  it('每种类型都有完整配置', () => {
    for (const genre of Object.keys(GENRE_PROFILES) as Genre[]) {
      const profile = profileFor(genre);
      expect(profile.label).toBeTruthy();
      expect(profile.traits.length).toBeGreaterThan(0);
      expect(profile.suggestedWordsPerChapter).toBeGreaterThan(0);
      for (const length of ['short'] as StoryLength[]) {
        expect(profile.suggestedChapters[length]).toBe(4);
      }
    }
  });

  it('短篇默认阶段顺序正确（含 relations）', () => {
    expect(stagesFor('xuanhuan')).toEqual([
      'premise',
      'world',
      'characters',
      'relations',
      'outline',
      'prose',
    ]);
  });

  it('声明跳过的类型其阶段列表不含该阶段', () => {
    expect(stagesFor('dushi')).not.toContain('world');
    expect(stagesFor('yanqing')).not.toContain('world');
    expect(stagesFor('xuanhuan')).toContain('world');
  });

  it('新类型与旧其他类型均可继续生成，世界观阶段符合类型配置', () => {
    expect(stagesFor('xianxia')).toContain('world');
    expect(stagesFor('chuanyue')).toContain('world');
    expect(stagesFor('cthulhu')).toContain('world');
    expect(profileFor('cthulhu').worldWeight).toBe('detailed');
    expect(stagesFor('chaogu')).not.toContain('world');
    expect(stagesFor('other')).toContain('prose');
  });

  it('组合类型阶段取并集，与选择顺序无关，创作特征与问卷合并', () => {
    expect(stagesFor(['dushi', 'chaogu'])).not.toContain('world');
    expect(stagesFor(['dushi', 'chuanyue'])).toContain('world');
    expect(stagesFor(['chuanyue', 'dushi'])).toEqual(stagesFor(['dushi', 'chuanyue']));
    const profile = profileFor(['xuanhuan', 'xuanyi']);
    expect(profile.label).toBe('玄幻、悬疑');
    expect(profile.worldWeight).toBe('detailed');
    expect(profile.traits).toEqual(
      expect.arrayContaining([...profileFor('xuanhuan').traits, ...profileFor('xuanyi').traits]),
    );
    expect(profile.extraQuestions.map((question) => question.key)).toEqual([
      'goldenFinger',
      'powerSystem',
      'caseScale',
      'puzzleStyle',
    ]);
    expect(stagesFor('["dushi","chuanyue"]')).toEqual(stagesFor(['dushi', 'chuanyue']));
  });

  it('世界观合并所有已选类型的结构，不丢失自定义块', () => {
    const schema = worldSchemaFor(['xuanhuan', 'kehuan']);
    expect(schema.shape).toHaveProperty('powerSystem');
    expect(schema.shape).toHaveProperty('techTree');
    expect(schema.shape).toHaveProperty('summary');
  });

  it('世界观详略随类型不同', () => {
    expect(profileFor('xuanhuan').worldWeight).toBe('detailed');
    expect(profileFor('dushi').worldWeight).toBe('minimal');
  });
});
