/**
 * Type declarations for react-native components used via react-native-web.
 * These extend the base react-native types with components that may be missing.
 */

declare module 'react-native' {
  import * as RN from 'react-native-web';
  export * from 'react-native-web';
  
  // Re-export Image if not available
  export const Image: typeof RN.Image;
  
  // Re-export Dimensions if not available  
  export const Dimensions: typeof RN.Dimensions;
}
