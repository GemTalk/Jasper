import { GciLibrary } from '../../client/src/gciLibrary';

export interface McpSessionConfig {
  libraryPath: string;
  stoneNrs: string;
  gemNrs: string;
  gsUser: string;
  gsPassword: string;
  hostUser?: string;
  hostPassword?: string;
}

export class McpSession {
  private gci: GciLibrary;
  private handle: unknown;

  constructor(config: McpSessionConfig) {
    this.gci = new GciLibrary(config.libraryPath);
    const result = this.gci.GciTsLogin(
      config.stoneNrs,
      config.hostUser || null,
      config.hostPassword || null,
      false,
      config.gemNrs,
      config.gsUser,
      config.gsPassword,
      0,
      0,
    );
    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }
    this.handle = result.session;
  }

  executeFetchString(code: string): string {
    return this.gci.executeAndFetchString(this.handle, code);
  }

  logout(): void {
    this.gci.logout(this.handle);
  }
}
