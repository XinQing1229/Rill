import { Genre, StoryLength } from '@rill/shared';
import { GENRE_PROFILES, profileFor, stagesFor } from './genre-profile';

describe('genre profile', () => {
  it('每种类型都有完整配置', () => {
    for (const genre of Object.keys(GENRE_PROFILES) as Genre[]) {
      const profile = profileFor(genre);
      expect(profile.label).toBeTruthy();
      expect(profile.traits.length).toBeGreaterThan(0);
      expect(profile.suggestedWordsPerChapter).toBeGreaterThan(0);
      for (const length of ['short', 'medium', 'long'] as StoryLength[]) {
        expect(profile.suggestedChapters[length]).toBeGreaterThan(0);
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
      'beats',
      'prose',
    ]);
  });

  it('声明跳过的类型其阶段列表不含该阶段', () => {
    expect(stagesFor('dushi')).not.toContain('world');
    expect(stagesFor('yanqing')).not.toContain('world');
    expect(stagesFor('xuanhuan')).toContain('world');
  });

  it('世界观详略随类型不同', () => {
    expect(profileFor('xuanhuan').worldWeight).toBe('detailed');
    expect(profileFor('dushi').worldWeight).toBe('minimal');
  });
});
