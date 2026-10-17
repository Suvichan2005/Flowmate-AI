import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/firebase', async importOriginal => ({ ...(await importOriginal<any>()), isFirebaseConfigured: () => true }));
vi.mock('../services/firestoreSync', () => Object.fromEntries(['saveUserData','loadUserData','subscribeToUserData','unsubscribeFromUserData','mergeData','mergeMessages','mergeChatSessions','saveMessage','saveFoodLogs','saveAttendanceData','saveChatSessions','deleteChannelMessages','syncEntities','syncRelationships','saveUserConfig'].map(name => [name, vi.fn()])));
import * as firestore from '../services/firestoreSync';
import { cleanupSync, initializeSync, setDemoModeSyncBlock } from '../services/syncManager';
afterEach(() => { cleanupSync(); setDemoModeSyncBlock(false); vi.clearAllMocks(); });
describe('Release stale listener acceptance (mock transport, real sync manager)', () => {
  it('drops a queued listener callback after entering demo', async () => {
    let deliver: Function | undefined;
    vi.mocked(firestore.loadUserData).mockResolvedValue(null);
    vi.mocked(firestore.subscribeToUserData).mockImplementation((_uid, callback) => { deliver=callback; return vi.fn(); });
    const receive=vi.fn(); initializeSync('synthetic-A',vi.fn(),receive,true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    receive.mockClear();
    expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1);
    expect(deliver).toBeTypeOf('function');
    setDemoModeSyncBlock(true);
    deliver!({ entities: [], relationships: [], universalTags: [] });
    expect(receive).not.toHaveBeenCalled();
  });
  it('does not deliver account A queued data to account B', async () => {
    let deliver: Function | undefined;
    vi.mocked(firestore.loadUserData).mockResolvedValue(null);
    vi.mocked(firestore.subscribeToUserData).mockImplementation((_uid, callback) => { deliver=callback; return vi.fn(); });
    initializeSync('synthetic-A',vi.fn(),vi.fn(),true);
    await vi.waitFor(() => expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1));
    expect(firestore.subscribeToUserData).toHaveBeenCalledTimes(1);
    expect(deliver).toBeTypeOf('function');
    const receiveB=vi.fn(); initializeSync('synthetic-B',vi.fn(),receiveB);
    deliver!({ entities: [], relationships: [], universalTags: [] });
    expect(receiveB).not.toHaveBeenCalled();
  });
});
