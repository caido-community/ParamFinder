import type { AttackType, Wordlist } from "shared";

import type { WordlistsRepository } from "../repositories";
import { SerialTaskQueue } from "../util";

const DEFAULT_ATTACK_TYPES: AttackType[] = ["body", "headers", "query"];

export class WordlistNotFoundError extends Error {}

export class WordlistsService {
  private readonly queue = new SerialTaskQueue();
  private initialized = false;

  constructor(private readonly repository: WordlistsRepository) {}

  async initialize(): Promise<void> {
    await this.queue.run(async () => {
      if (this.initialized) {
        return;
      }

      await this.repository.initialize();

      this.initialized = true;
    });
  }

  async getWordlists(): Promise<Wordlist[]> {
    return this.queue.run(async () => {
      this.assertInitialized();

      return this.repository.list();
    });
  }

  async importWordlist(data: string, filename: string): Promise<Wordlist> {
    return this.queue.run(async () => {
      this.assertInitialized();

      const filePath = await this.repository.createFile(data, filename);
      const wordlist: Wordlist = {
        path: filePath,
        enabled: true,
        attackTypes: [...DEFAULT_ATTACK_TYPES],
      };

      try {
        await this.repository.insert(wordlist);
      } catch (cause) {
        await this.repository.removeFile(filePath).catch(() => undefined);
        throw cause;
      }

      return wordlist;
    });
  }

  async deleteWordlist(filePath: string): Promise<void> {
    await this.queue.run(async () => {
      this.assertInitialized();

      const registeredPath = await this.repository.findPath(filePath);

      if (registeredPath === undefined) {
        throw new WordlistNotFoundError("Wordlist not found");
      }

      await this.repository.delete(registeredPath);

      await this.repository.removeFile(registeredPath).catch(() => undefined);
    });
  }

  async clearWordlists(): Promise<void> {
    await this.queue.run(async () => {
      this.assertInitialized();

      const wordlists = await this.repository.list();

      await this.repository.clear();
      await Promise.all(
        wordlists.map((wordlist) =>
          this.repository.removeFile(wordlist.path).catch(() => undefined),
        ),
      );
    });
  }

  async setEnabled(filePath: string, enabled: boolean): Promise<void> {
    await this.queue.run(async () => {
      this.assertInitialized();

      await this.repository.setEnabled(filePath, enabled);
    });
  }

  async setAttackTypes(
    filePath: string,
    attackTypes: AttackType[],
  ): Promise<void> {
    await this.queue.run(async () => {
      this.assertInitialized();

      await this.repository.setAttackTypes(filePath, attackTypes);
    });
  }

  async loadEnabledWords(attackType: AttackType): Promise<string[]> {
    return this.queue.run(async () => {
      this.assertInitialized();

      const wordlists = await this.repository.list();
      const words = await Promise.all(
        wordlists
          .filter(
            (wordlist) =>
              wordlist.enabled && wordlist.attackTypes.includes(attackType),
          )
          .map((wordlist) => this.repository.readWords(wordlist.path)),
      );

      return [...new Set(words.flat())];
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("Wordlists service not initialized");
    }
  }
}
