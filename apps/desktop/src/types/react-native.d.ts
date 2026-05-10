// Type declarations for react-native when using react-native-web
// This allows TypeScript to understand react-native imports in the desktop renderer

declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';
  
  export interface ViewStyle {
    [key: string]: any;
  }
  
  export interface TextStyle extends ViewStyle {
    fontSize?: number;
    fontWeight?: string;
    color?: string;
    textAlign?: 'left' | 'center' | 'right';
  }
  
  export interface ViewProps {
    style?: ViewStyle | ViewStyle[];
    children?: ReactNode;
    className?: string;
    [key: string]: any;
  }
  
  export interface TextProps {
    style?: TextStyle | TextStyle[];
    children?: ReactNode;
    [key: string]: any;
  }
  
  export interface TextInputProps {
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    multiline?: boolean;
    editable?: boolean;
    secureTextEntry?: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
    style?: TextStyle | TextStyle[];
    placeholderTextColor?: string;
    textAlignVertical?: 'top' | 'center' | 'bottom';
    [key: string]: any;
  }
  
  export interface PressableProps {
    onPress?: (e?: any) => void;
    disabled?: boolean;
    style?: ViewStyle | ViewStyle[] | ((state: { pressed: boolean }) => ViewStyle | ViewStyle[]);
    children?: ReactNode;
    [key: string]: any;
  }
  
  export interface ActivityIndicatorProps {
    size?: 'small' | 'large';
    color?: string;
    style?: ViewStyle | ViewStyle[];
  }
  
  export interface ModalProps {
    visible?: boolean;
    transparent?: boolean;
    animationType?: 'none' | 'slide' | 'fade';
    onRequestClose?: () => void;
    children?: ReactNode;
  }
  
  export const View: ComponentType<ViewProps>;
  export const Text: ComponentType<TextProps>;
  export const TextInput: ComponentType<TextInputProps>;
  export const Pressable: ComponentType<PressableProps>;
  export const ActivityIndicator: ComponentType<ActivityIndicatorProps>;
  export const Modal: ComponentType<ModalProps>;
  export const ScrollView: ComponentType<ViewProps>;
  export const FlatList: ComponentType<any>;
  export const SafeAreaView: ComponentType<ViewProps>;
  export const KeyboardAvoidingView: ComponentType<ViewProps & { behavior?: 'height' | 'position' | 'padding' }>;
  
  export const StyleSheet: {
    create<T extends Record<string, ViewStyle>>(styles: T): T;
    absoluteFillObject: ViewStyle;
  };
  
  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
    select: <T>(specifics: { ios?: T; android?: T; web?: T; default?: T }) => T;
  };
  
  export const Appearance: {
    getColorScheme: () => 'light' | 'dark' | null;
  };
}
