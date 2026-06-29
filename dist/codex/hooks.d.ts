export interface HookStatus {
    pathmark: boolean;
    legacy: boolean;
}
export declare function installPathmarkHooks(options?: {
    replaceLegacyHooks?: boolean;
    hooksPath?: string;
}): Promise<void>;
export declare function uninstallPathmarkHooks(hooksPath?: string): Promise<void>;
export declare function hookStatus(hooksPath?: string): Promise<HookStatus>;
