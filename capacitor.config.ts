import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.flowmate.app',
    appName: 'Flowmate',
    webDir: 'dist',
    server: {
        androidScheme: 'https'
    },
    plugins: {
        LocalNotifications: {
            smallIcon: "ic_stat_icon_config_sample",
            iconColor: "#6366f1"
        },
        SplashScreen: {
            launchShowDuration: 2000,
            backgroundColor: "#0f172a",
            showSpinner: false
        }
    }
};

export default config;
