export interface HookStatus {
    pathmark: boolean;
    honcho: boolean;
}
export declare function installPathmarkHooks(options?: {
    replaceHoncho?: boolean;
    hooksPath?: string;
}): Promise<void>;
export declare function uninstallPathmarkHooks(hooksPath?: string): Promise<void>;
export declare function hookStatus(hooksPath?: string): Promise<HookStatus>;
