import { Abs_championsService } from '../generated/services/Abs_championsService';
import { normalizeChampionUserId } from '../lib/championIdentity';

type CreateChampion = Parameters<typeof Abs_championsService.create>[0];
type UpdateChampion = Parameters<typeof Abs_championsService.update>[1];
const pendingIdentities = new Set<string>();

export async function findChampionProfiles(userId: string) {
  const identity = normalizeChampionUserId(userId);
  if (!identity) throw new Error('A Champion User ID (email / UPN) is required.');
  const result = await Abs_championsService.getAll({
    select: ['abs_championid', 'abs_userid', 'crd49_displayname', 'crd49_status'],
    filter: `(abs_userid eq '${identity.replace(/'/g, "''")}' or abs_normalizeduserid eq '${identity.replace(/'/g, "''")}')`,
    top: 2,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message ?? 'Could not check existing Champions. No changes were saved.');
  }
  return result.data;
}

async function uniqueWrite<T>(userId: string, write: (identity: string) => Promise<T>, currentId?: string): Promise<T> {
  const identity = normalizeChampionUserId(userId);
  if (!identity) throw new Error('A Champion User ID (email / UPN) is required.');
  if (identity.length > 320) throw new Error('A Champion User ID must be no more than 320 characters.');
  if (pendingIdentities.has(identity)) {
    throw new Error('A save for this Champion User ID is already in progress. Wait for it to finish.');
  }
  pendingIdentities.add(identity);
  try {
    const matches = await findChampionProfiles(identity);
    if (matches.some((champion) => champion.abs_championid.toLowerCase() !== currentId?.toLowerCase())) {
      throw new Error('A Champion with this User ID already exists. Edit or enable the existing profile instead of adding another.');
    }
    return await write(identity);
  } finally {
    pendingIdentities.delete(identity);
  }
}

export class ChampionsService extends Abs_championsService {
  public static override async create(record: CreateChampion) {
    return uniqueWrite(record.abs_userid, (identity) => super.create({ ...record, abs_userid: identity }));
  }

  public static override async update(id: string, fields: UpdateChampion) {
    if (!Object.hasOwn(fields, 'abs_userid')) return super.update(id, fields);
    return uniqueWrite(fields.abs_userid ?? '', (identity) => super.update(id, { ...fields, abs_userid: identity }), id);
  }
}
