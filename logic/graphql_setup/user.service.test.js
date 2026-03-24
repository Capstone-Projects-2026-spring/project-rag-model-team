import { jest } from '@jest/globals';

const mockAll = jest.fn();

await jest.unstable_mockModule('../database/sqlite.js', () => ({
  default: {
    prepare: jest.fn(() => ({ all: mockAll })),
  },
}));

const { getAllUsers } = await import('./user.service.js');

afterEach(() => {
  jest.clearAllMocks();
});

describe('getAllUsers', () => {
  it('returns a list of all users', () => {
    const mockUsers = [
      { id: '1', created_at: '2024-01-01' },
      { id: '2', created_at: '2025-02-01' },
    ];
    mockAll.mockReturnValue(mockUsers);

    const result = getAllUsers();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].created_at).toBe('2025-02-01');
  });

  it('returns an empty array when there are no users', () => {
    mockAll.mockReturnValue([]);

    const result = getAllUsers();

    expect(result).toEqual([]);
  });

  it('only returns the expected fields per user', () => {
    mockAll.mockReturnValue([
      { id: '1', created_at: '2024-01-01' },
    ]);

    const result = getAllUsers();
    const user = result[0];

    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('created_at');
  });

  it('throws when the DB call fails', () => {
    mockAll.mockImplementation(() => { throw new Error('DB connection failed'); });

    expect(() => getAllUsers()).toThrow('DB connection failed');
  });
});
