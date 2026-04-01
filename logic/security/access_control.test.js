import {
  buildAccessDeniedMessage,
  canAccessClassification,
  filterAccessibleFiles,
  filterAccessibleProfiles,
  getClassificationForRole,
  parseDriveFileClassification,
} from './access_control.js';

describe('access control helpers', () => {
  it('maps roles to default classifications', () => {
    expect(getClassificationForRole('junior_dev')).toBe('internal');
    expect(getClassificationForRole('senior_dev')).toBe('confidential');
    expect(getClassificationForRole('manager')).toBe('restricted');
    expect(getClassificationForRole('unknown_role')).toBe('internal');
  });

  it('compares classification levels correctly', () => {
    expect(canAccessClassification('restricted', 'confidential')).toBe(true);
    expect(canAccessClassification('internal', 'internal')).toBe(true);
    expect(canAccessClassification('internal', 'confidential')).toBe(false);
  });

  it('reads document classification from drive metadata', () => {
    expect(
      parseDriveFileClassification({
        description: 'classification: confidential',
      }),
    ).toBe('confidential');

    expect(
      parseDriveFileClassification({
        name: 'team-overview.json',
      }),
    ).toBe('internal');
  });

  it('filters files by requester classification', () => {
    const files = [
      { id: '1', name: 'general.json', description: 'classification: internal' },
      { id: '2', name: 'secrets.json', description: 'classification: restricted' },
    ];

    const visibleToJunior = filterAccessibleFiles(files, 'internal');
    const visibleToManager = filterAccessibleFiles(files, 'restricted');

    expect(visibleToJunior.map((file) => file.id)).toEqual(['1']);
    expect(visibleToManager.map((file) => file.id)).toEqual(['1', '2']);
  });

  it('filters user profiles by requester classification', () => {
    const profiles = [
      {
        session_id: 'U1',
        userInfo: { role: 'junior_dev', classification_level: 'internal' },
      },
      {
        session_id: 'U2',
        userInfo: { role: 'manager', classification_level: 'restricted' },
      },
    ];

    expect(filterAccessibleProfiles(profiles, 'internal')).toHaveLength(1);
    expect(filterAccessibleProfiles(profiles, 'restricted')).toHaveLength(2);
  });

  it('builds a helpful access denied message', () => {
    expect(buildAccessDeniedMessage('roadmap')).toContain('roadmap');
  });
});
