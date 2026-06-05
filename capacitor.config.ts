import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.bhupesh.fittrack',
  appName: 'FitTrack',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};
export default config;
