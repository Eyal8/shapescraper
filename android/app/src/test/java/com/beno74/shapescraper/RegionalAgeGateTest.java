package com.beno74.shapescraper;

import android.app.Activity;
import com.google.android.gms.tasks.Task;
import com.google.android.play.agesignals.*;
import com.google.android.play.agesignals.model.*;
import com.google.android.play.agesignals.testing.FakeAgeSignalsManager;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

public class RegionalAgeGateTest {
    static class Manager extends FakeAgeSignalsManager {
        int applicabilityCalls, accessCalls, signalCalls;
        @Override public Task<ApplicableAgeFeaturesResult> getApplicableAgeFeatures(ApplicableAgeFeaturesRequest request) {
            applicabilityCalls++; return super.getApplicableAgeFeatures(request);
        }
        @Override public Task<AgeSignalsAccessResult> requestAgeSignalsAccess(AgeSignalsAccessRequest request) {
            accessCalls++; return super.requestAgeSignalsAccess(request);
        }
        @Override public Task<AgeSignalsResult> checkAgeSignals(AgeSignalsRequest request) {
            signalCalls++; return super.checkAgeSignals(request);
        }
    }
    Manager configured(boolean required) {
        Manager m=new Manager();
        m.setNextApplicableAgeFeaturesResult(ApplicableAgeFeaturesResult.builder().setFeatures(required ?
            Collections.singleton(ApplicableAgeFeature.MANDATORY_SHARING) : Collections.emptySet()).build());
        m.setNextAgeSignalsAccessResult(AgeSignalsAccessResult.builder().setAgeSignalsStatus(AgeSignalsStatus.SHARED).build());
        m.setNextAgeSignalsResult(range(18,null,null));
        return m;
    }
    AgeSignalsResult range(Integer lower,Integer upper,Integer change) {
        return AgeSignalsResult.builder().setAgeLower(lower).setAgeUpper(upper)
            .setAgeRangeSource(AgeRangeSource.TIER_B).setSignificantChangeStatus(change).build();
    }
    RegionalAgeGate.Decision request(Manager m) {
        AtomicReference<RegionalAgeGate.Decision> result=new AtomicReference<>();
        new RegionalAgeGate(m,Runnable::run).request(new Activity(),result::set);
        assertNotNull(result.get()); return result.get();
    }
    @Test public void noObligationNeverCallsAccessEvenIfRequestInvoked() {
        Manager m=configured(false);
        assertEquals("notRequired",request(m).status);
        assertEquals(1,m.applicabilityCalls); assertEquals(0,m.accessCalls); assertEquals(0,m.signalCalls);
    }
    @Test public void silentCheckDoesNotRequestSharingInMandatoryRegion() {
        Manager m=configured(true); AtomicReference<RegionalAgeGate.Decision> result=new AtomicReference<>();
        new RegionalAgeGate(m,Runnable::run).requirements(result::set);
        assertEquals("required",result.get().status); assertEquals(0,m.accessCalls);
    }
    @Test public void requiredRequestChecksAgainThenReadsSharedSignals() {
        Manager m=configured(true); assertEquals("resolved",request(m).status);
        assertEquals(1,m.applicabilityCalls); assertEquals(1,m.accessCalls); assertEquals(1,m.signalCalls);
    }
    @Test public void inclusiveBoundsAndCustomBands() {
        int[][] minors={{0,12},{13,15},{16,17},{12,17}};
        for(int[] band:minors) {
            RegionalAgeGate.Decision d=RegionalAgeGate.classify(range(band[0],band[1],SignificantChangeStatus.APPROVED));
            assertEquals("resolved",d.status); assertTrue(d.minor); assertEquals(band[0]<13,d.childDirected);
        }
        assertFalse(RegionalAgeGate.classify(range(18,null,null)).minor);
        assertEquals("resolved",RegionalAgeGate.classify(range(18,18,null)).status);
        Integer[][] unknown={{null,null},{13,null},{16,18},{0,18},{18,17},{-1,12},{19,null}};
        for(Integer[] band:unknown) assertEquals("unresolved",RegionalAgeGate.classify(range(band[0],band[1],null)).status);
    }
    @Test public void verificationRefusalUnknownAndErrorsStayRestricted() {
        int[] states={AgeSignalsStatus.VERIFICATION_REQUIRED,AgeSignalsStatus.NOT_SHARED,AgeSignalsStatus.UNSPECIFIED};
        String[] expected={"verificationRequired","declined","unresolved"};
        for(int i=0;i<states.length;i++) {
            Manager m=configured(true);
            m.setNextAgeSignalsAccessResult(AgeSignalsAccessResult.builder().setAgeSignalsStatus(states[i]).build());
            assertEquals(expected[i],request(m).status); assertEquals(0,m.signalCalls);
        }
        Manager preflight=configured(true); preflight.setNextApplicableAgeFeaturesException(new AgeSignalsException(-3));
        assertEquals("unavailable",request(preflight).status); assertEquals(0,preflight.accessCalls);
        Manager access=configured(true); access.setNextRequestAgeSignalsAccessException(new AgeSignalsException(-3));
        assertEquals("unavailable",request(access).status); assertEquals(0,access.signalCalls);
        Manager signals=configured(true); signals.setNextAgeSignalsException(new AgeSignalsException(-3));
        assertEquals("unavailable",request(signals).status);
    }
    @Test public void pendingOrDeclinedApprovalCannotEnableMonetizationOrMeasurement() {
        for(int status:new int[]{SignificantChangeStatus.PENDING,SignificantChangeStatus.DECLINED})
            assertEquals("unresolved",RegionalAgeGate.classify(range(13,15,status)).status);
    }
}
