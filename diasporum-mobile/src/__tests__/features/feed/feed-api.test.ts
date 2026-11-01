/**
 * Feed API service tests — verifies correct endpoints, methods and payloads.
 * Uses a mock apiClient — no network.
 */

import { createFeedApi } from '@/features/feed/services/feed-api';

jest.mock('@/core/config/env', () => ({
  appConfig: { apiBaseUrl: 'http://localhost:8080' },
  getTokenEndpoint: jest.fn(), getEndSessionEndpoint: jest.fn(), getKeycloakIssuer: jest.fn(),
}));

const client = {
  get: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};

beforeEach(() => jest.clearAllMocks());

const api = createFeedApi(client as never);

describe('feedApi', () => {
  it('communityFeed hits correct endpoint', async () => {
    await api.communityFeed('c1', 'FOR_YOU', undefined, undefined, 20);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('/feed/community?communityId=c1&mode=FOR_YOU&size=20'),
      expect.objectContaining({ authenticated: true })
    );
  });

  it('communityFeed passes cursor when provided', async () => {
    await api.communityFeed('c1', 'FOR_YOU', undefined, 'abc123', 20);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('&cursor=abc123'),
      expect.anything()
    );
  });

  it('followingFeed hits correct endpoint', async () => {
    await api.followingFeed('cur1', 20);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('/feed/following?size=20&cursor=cur1'),
      expect.objectContaining({ authenticated: true })
    );
  });

  it('createPost posts correct payload', async () => {
    await api.createPost({ communityId: 'c1', postType: 'GENERAL', body: 'hello' });
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/posts',
      { communityId: 'c1', postType: 'GENERAL', body: 'hello' },
      expect.objectContaining({ authenticated: true })
    );
  });

  it('getPost hits correct path', async () => {
    await api.getPost('p1');
    expect(client.get).toHaveBeenCalledWith('/api/v1/feed/posts/p1', expect.anything());
  });

  it('react puts reaction', async () => {
    await api.react('p1', 'LIKE');
    expect(client.put).toHaveBeenCalledWith('/api/v1/feed/posts/p1/reaction',
      { reaction: 'LIKE' }, expect.anything());
  });

  it('unreact deletes reaction', async () => {
    await api.unreact('p1');
    expect(client.delete).toHaveBeenCalledWith('/api/v1/feed/posts/p1/reaction', expect.anything());
  });

  it('save puts save', async () => {
    await api.save('p1');
    expect(client.put).toHaveBeenCalledWith('/api/v1/feed/posts/p1/save', {}, expect.anything());
  });

  it('unsave deletes save', async () => {
    await api.unsave('p1');
    expect(client.delete).toHaveBeenCalledWith('/api/v1/feed/posts/p1/save', expect.anything());
  });

  it('recordView posts view', async () => {
    await api.recordView('FEED_POST', 'p1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/views',
      { contentType: 'FEED_POST', contentId: 'p1' }, expect.anything());
  });

  it('comment posts with parentCommentId when provided', async () => {
    await api.comment('p1', 'nice', 'c1');
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/posts/p1/comments',
      { body: 'nice', parentCommentId: 'c1' }, expect.anything());
  });

  it('comment posts without parentCommentId for top-level', async () => {
    await api.comment('p1', 'nice');
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/posts/p1/comments',
      { body: 'nice' }, expect.anything());
  });

  it('comments uses page/size pagination', async () => {
    await api.comments('p1', 2, 20);
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/feed/posts/p1/comments?page=2&size=20', expect.anything());
  });

  it('createHelpPost posts correct payload', async () => {
    await api.createHelpPost({ communityId: 'c1', helpKind: 'REQUEST', title: 'help', body: 'need help' });
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/community-help',
      { communityId: 'c1', helpKind: 'REQUEST', title: 'help', body: 'need help' },
      expect.anything());
  });

  it('createPoll posts question and options', async () => {
    await api.createPoll({ communityId: 'c1', question: 'Best city?', options: ['A', 'B'] });
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/polls',
      { communityId: 'c1', question: 'Best city?', options: ['A', 'B'] },
      expect.anything());
  });

  it('vote posts to option endpoint', async () => {
    await api.vote('opt1', false);
    expect(client.post).toHaveBeenCalledWith('/api/v1/feed/polls/options/opt1/vote',
      { withdraw: false }, expect.anything());
  });

  it('recordView swallows errors silently', async () => {
    client.post.mockRejectedValueOnce(new Error('network'));
    await expect(api.recordView('FEED_POST', 'p1')).resolves.not.toThrow();
  });
});
