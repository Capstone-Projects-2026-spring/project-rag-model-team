import { jest } from '@jest/globals';

const mockAll = jest.fn();

await jest.unstable_mockModule('./db.js', () => ({
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
      { id: '1', email: 'alice@example.com', username: 'alice', is_active: true,  created_at: '2024-01-01' },
      { id: '2', email: 'bob@example.com',   username: 'bob',   is_active: false, created_at: '2024-02-01' },
    ];
    mockAll.mockReturnValue(mockUsers);

    const result = getAllUsers();

    expect(result).toHaveLength(2);
    expect(result[0].email).toBe('alice@example.com');
    expect(result[1].username).toBe('bob');
  });

  it('returns an empty array when there are no users', () => {
    mockAll.mockReturnValue([]);

    const result = getAllUsers();

    expect(result).toEqual([]);
  });

  it('only returns the expected fields per user', () => {
    mockAll.mockReturnValue([
      { id: '1', email: 'alice@example.com', username: 'alice', is_active: true, created_at: '2024-01-01' },
    ]);

    const result = getAllUsers();
    const user = result[0];

    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('username');
    expect(user).toHaveProperty('is_active');
    expect(user).toHaveProperty('created_at');
    expect(user).not.toHaveProperty('password');
  });

  it('throws when the DB call fails', () => {
    mockAll.mockImplementation(() => { throw new Error('DB connection failed'); });

    expect(() => getAllUsers()).toThrow('DB connection failed');
  });
});
