import dk.aau.cs.model.CPN.ColorType;
import dk.aau.cs.model.tapn.*;
import dk.aau.cs.model.tapn.simulation.*;
import java.math.BigDecimal;
import java.util.*;
/** Released 4.0.4 valid synchronized models; assertions, no mutator bypass. */
public class SynchronizedTransitionReference {
  static int assertions;
  static void check(boolean b) { if(!b) throw new AssertionError(); assertions++; }
  static TimedToken token(TimedPlace p, int age) { return new TimedToken(p,new BigDecimal(age),ColorType.COLORTYPE_DOT.getFirstColor()); }
  static String ages(List<TimedToken> tokens) { return tokens.stream().map(t -> t.age().stripTrailingZeros().toPlainString()).sorted().toList().toString(); }
  public static void main(String[] args) {
    for(boolean transport: new boolean[]{false,true}) for(int weight:new int[]{1,2}) for(String policy: new String[]{"oldest","youngest","manual"}) for(boolean secondActive:new boolean[]{false,true}) {
      var network=new TimedArcPetriNetNetwork(); var shared=new SharedTransition("Sync");network.add(shared);
      var places=new ArrayList<TimedPlace>(); var outputs=new ArrayList<TimedPlace>();var transitions=new ArrayList<TimedTransition>();
      for(int i=0;i<3;i++) {
        var c=new TimedArcPetriNet("C"+i);network.add(c);c.setActive(i==0 || (i==1 && secondActive));
        var p=new LocalTimedPlace("P");var q=new LocalTimedPlace("Q");c.add(p);c.add(q);
        var t=new TimedTransition("T");c.add(t);shared.makeShared(t);
        if(transport) {var arc=new TransportArc(p,t,q,TimeInterval.ZERO_INF);arc.setWeight(new IntWeight(weight));c.add(arc);}
        else {var in=new TimedInputArc(p,t,TimeInterval.ZERO_INF);in.setWeight(new IntWeight(weight));c.add(in);var out=new TimedOutputArc(t,q);out.setWeight(new IntWeight(weight));c.add(out);}
        p.addToken(token(p,1));p.addToken(token(p,2)); places.add(p);outputs.add(q);transitions.add(t);
      }
      check(shared.isEnabled());
      var selected=new ArrayList<TimedToken>();for(int i=0;i<(secondActive?2:1);i++) {var ts=new ArrayList<>(places.get(i).tokens());ts.sort(Comparator.comparing(TimedToken::age));if(!policy.equals("youngest"))Collections.reverse(ts);selected.addAll(ts.subList(0,weight));}
      NetworkMarking result;
      if(policy.equals("manual")) result=network.marking().fireTransition(transitions.get(0),selected);
      else result=network.marking().fireTransition(transitions.get(0),policy.equals("oldest")?new OldestFiringMode():new YoungestFiringMode()).value1();
      for(int i=0;i<3;i++){boolean active=i==0||(i==1&&secondActive);if(!active){check(places.get(i).numberOfTokens()==2);continue;}check(result.getTokensFor(places.get(i)).size()==2-weight);check(result.getTokensFor(outputs.get(i)).size()==weight);if(active)for(var t:result.getTokensFor(outputs.get(i)))check(transport?t.age().signum()>0:t.age().signum()==0);}
      String snapshot="case "+transport+" "+weight+" "+policy+" "+secondActive;
      for(int i=0;i<3;i++) {boolean active=i==0||(i==1&&secondActive);snapshot+=" | "+ages(active?result.getTokensFor(places.get(i)):places.get(i).tokens())+"/"+ages(active?result.getTokensFor(outputs.get(i)):outputs.get(i).tokens());}
      System.out.println(snapshot);
      check(places.get(0).numberOfTokens()==2); // firing returns a new marking
      places.get(0).removeToken();places.get(0).removeToken();check(!shared.isEnabled());
      shared.setUrgent(true);check(transitions.get(0).isUrgent()&&transitions.get(2).isUrgent());check(!shared.isEnabled());
    }
    System.out.println("native synchronized assertions="+assertions);System.exit(0);
  }
}
