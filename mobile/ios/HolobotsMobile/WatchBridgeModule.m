#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WatchBridgeModule, RCTEventEmitter)

RCT_EXTERN_METHOD(sendRewardsToWatch:(NSString *)date rewards:(NSDictionary *)rewards)

@end
