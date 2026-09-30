#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>

#if __has_include(<UnityFramework/UnityFramework.h>)
#import <UnityFramework/UnityFramework.h>
#define HB_HAS_UNITY 1
#else
#define HB_HAS_UNITY 0
#endif

// One engine per process. A closed view is paused, not quit (Unity cannot restart after quit).
#if HB_HAS_UNITY
static UnityFramework *HBFramework;
static UIWindow *HBHostWindow;
static NSString *HBReadyMessage;
static char **HBArgv;
static int HBArgc;
#endif

@interface HolobotsUnityRuntime : RCTEventEmitter <RCTBridgeModule>
@property(nonatomic) BOOL observing;
@property(nonatomic) BOOL visible;
@property(nonatomic) BOOL manuallyPaused;
@property(nonatomic) BOOL invalidated;
@property(nonatomic, strong) UIButton *exitButton;
@end

@implementation HolobotsUnityRuntime
RCT_EXPORT_MODULE(HolobotsUnityRuntime)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"UnityMessage"]; }
- (instancetype)init {
  if ((self = [super init])) {
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(background:) name:UIApplicationWillResignActiveNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(foreground:) name:UIApplicationDidBecomeActiveNotification object:nil];
  }
  return self;
}
- (void)startObserving {
  if (self.observing || self.invalidated) return;
  self.observing = YES;
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(unityMessage:) name:@"HolobotsUnityMessage" object:nil];
}
- (void)stopObserving {
  self.observing = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"HolobotsUnityMessage" object:nil];
  [self closeNative];
}
- (void)unityMessage:(NSNotification *)note {
  id value = note.userInfo[@"json"];
  if (![value isKindOfClass:NSString.class] || [value lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 262144) return;
  NSString *json = [value copy];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.invalidated || !self.observing || !self.visible) return;
    id body = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![body isKindOfClass:NSDictionary.class]) return;
#if HB_HAS_UNITY
    if ([body[@"schemaVersion"] isEqual:@"runtime-ready-1"]) HBReadyMessage = json;
#endif
    [self sendEventWithName:@"UnityMessage" body:@{@"json": json}];
  });
}
- (void)background:(NSNotification *)note {
#if HB_HAS_UNITY
  if (HBFramework.appController) [HBFramework pause:YES];
#endif
}
- (void)foreground:(NSNotification *)note {
#if HB_HAS_UNITY
  if (self.visible && !self.manuallyPaused && !self.invalidated && HBFramework.appController) [HBFramework pause:NO];
#endif
}
- (void)closeNative {
  self.visible = NO; self.manuallyPaused = YES;
  [self.exitButton removeFromSuperview];self.exitButton=nil;
#if HB_HAS_UNITY
  if (HBFramework.appController) {
    [HBFramework pause:YES];
    HBFramework.appController.window.hidden = YES;
  }
  [HBHostWindow makeKeyAndVisible];
#endif
}
- (void)requestExit {
  if (self.visible && self.observing && !self.invalidated)
    [self sendEventWithName:@"UnityMessage" body:@{@"json":@"{\"schemaVersion\":\"runtime-exit-1\"}"}];
}
RCT_REMAP_METHOD(open, openWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.invalidated || !self.observing) { reject(@"unavailable", @"Subscribe to UnityMessage before opening Unity.", nil); return; }
#if HB_HAS_UNITY
  if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive) { reject(@"unavailable", @"Unity can open only while the app is active.", nil); return; }
  if (!self.visible) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:UIWindowScene.class] || scene.activationState != UISceneActivationStateForegroundActive) continue;
      for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow) HBHostWindow = window;
    }
    if (!HBHostWindow) { reject(@"unavailable", @"The host window is not ready.", nil); return; }
  }
  if (!HBFramework) {
    NSString *path = [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Frameworks/UnityFramework.framework"];
    NSBundle *bundle = [NSBundle bundleWithPath:path];
    if (!bundle || (![bundle isLoaded] && ![bundle load])) { reject(@"unavailable", @"UnityFramework is not embedded in this app.", nil); return; }
    Class runtime = bundle.principalClass;
    if (!runtime || ![runtime respondsToSelector:@selector(getInstance)]) { reject(@"unavailable", @"UnityFramework is invalid.", nil); return; }
    HBFramework = [runtime getInstance];
    if (!HBFramework) { reject(@"unavailable", @"UnityFramework could not initialize.", nil); return; }
    [HBFramework setDataBundleId:"com.unity3d.framework"];
  }
  self.visible = YES; self.manuallyPaused = NO;
  if (!HBFramework.appController) {
    NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
    HBArgc = (int)args.count; HBArgv = calloc((size_t)HBArgc + 1, sizeof(char *));
    for (int i = 0; i < HBArgc; i++) HBArgv[i] = strdup(args[i].UTF8String);
    [HBFramework runEmbeddedWithArgc:HBArgc argv:HBArgv appLaunchOpts:nil];
  }
  [HBFramework showUnityWindow]; [HBFramework pause:NO];
  if (!self.exitButton) {
    UIWindow *window = HBFramework.appController.window;
    self.exitButton = [UIButton buttonWithType:UIButtonTypeSystem];
    self.exitButton.translatesAutoresizingMaskIntoConstraints = NO;
    [self.exitButton setTitle:@"Back to dashboard" forState:UIControlStateNormal];
    [self.exitButton setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    self.exitButton.backgroundColor = [UIColor colorWithWhite:0.03 alpha:0.88];
    self.exitButton.titleLabel.font = [UIFont systemFontOfSize:14 weight:UIFontWeightSemibold];
    self.exitButton.accessibilityLabel = @"Back to dashboard";
    [self.exitButton addTarget:self action:@selector(requestExit) forControlEvents:UIControlEventTouchUpInside];
    [window addSubview:self.exitButton];
    [NSLayoutConstraint activateConstraints:@[
      [self.exitButton.trailingAnchor constraintEqualToAnchor:window.safeAreaLayoutGuide.trailingAnchor constant:-12],
      [self.exitButton.topAnchor constraintEqualToAnchor:window.safeAreaLayoutGuide.topAnchor constant:12],
      [self.exitButton.widthAnchor constraintEqualToConstant:180],
      [self.exitButton.heightAnchor constraintEqualToConstant:44]
    ]];
  }
  resolve(@YES);
  // Replay only an actual ready signal from this retained runtime, never fabricate readiness.
  if (HBReadyMessage) {
    NSString *ready = HBReadyMessage;
    dispatch_async(dispatch_get_main_queue(), ^{ if (self.visible && self.observing && !self.invalidated) [self sendEventWithName:@"UnityMessage" body:@{@"json":ready}]; });
  }
#else
  reject(@"unavailable", @"This build does not include UnityFramework.", nil);
#endif
}
RCT_REMAP_METHOD(pause, pauseWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if HB_HAS_UNITY
  if (!self.visible || !HBFramework.appController) { reject(@"unavailable", @"Unity is not open.", nil); return; }
  self.manuallyPaused = YES; [HBFramework pause:YES]; resolve(@YES);
#else
  reject(@"unavailable", @"This build does not include UnityFramework.", nil);
#endif
}
RCT_REMAP_METHOD(resume, resumeWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if HB_HAS_UNITY
  if (!self.visible || !HBFramework.appController || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) { reject(@"unavailable", @"Unity is not active.", nil); return; }
  self.manuallyPaused = NO; [HBFramework pause:NO]; resolve(@YES);
#else
  reject(@"unavailable", @"This build does not include UnityFramework.", nil);
#endif
}
RCT_REMAP_METHOD(close, closeWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self closeNative]; resolve(@YES);
}
RCT_REMAP_METHOD(send, sendJSON:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if HB_HAS_UNITY
  if (!self.visible || !HBFramework.appController || self.invalidated) { reject(@"unavailable", @"Unity is not open.", nil); return; }
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data || data.length > 262144 || ![[NSJSONSerialization JSONObjectWithData:data options:0 error:nil] isKindOfClass:NSDictionary.class]) { reject(@"invalid_request", @"Expected a bounded JSON object.", nil); return; }
  [HBFramework sendMessageToGOWithName:"HoloMobileBridge" functionName:"Receive" message:json.UTF8String]; resolve(@YES);
#else
  reject(@"unavailable", @"This build does not include UnityFramework.", nil);
#endif
}
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.invalidated = YES; self.observing = NO;
    [[NSNotificationCenter defaultCenter] removeObserver:self]; [self closeNative];
  });
  [super invalidate];
}
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }
@end
