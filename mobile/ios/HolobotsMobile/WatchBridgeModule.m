#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WatchBridgeModule, RCTEventEmitter)

RCT_EXTERN_METHOD(sendRewardsToWatch:(NSString *)workoutId rewards:(NSDictionary *)rewards)
RCT_EXTERN_METHOD(getPendingWatchWorkouts:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(ackWatchWorkout:(NSString *)workoutId)
RCT_EXTERN_METHOD(syncOwnedHolobots:(NSArray<NSString *> *)ownedHolobotNames)
RCT_EXTERN_METHOD(syncDailySessionState:(NSDictionary *)state)
RCT_EXTERN_METHOD(syncWorkoutPresence:(NSDictionary *)presence)
RCT_EXTERN_METHOD(getWatchWorkoutPresence:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
